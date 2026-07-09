// POST /api/suggest — ボタン起点の AI サジェスト (自動実行はしない)。
// GET /api/suggestions/latest — 直近の提案を再表示用に返す。

import type { Hono } from 'hono';
import type { PluginContext } from '../../../host/types.js';
import { listGifts, yearlyTotalYen } from '../gifts-repo.js';
import { listBookmarks } from '../bookmarks-repo.js';
import { getSettings } from '../settings-repo.js';
import { estimateFurusatoLimit } from '../simulate.js';
import { buildSuggestPrompt } from '../suggest-prompt.js';
import { saveSuggestion, latestSuggestion } from '../suggestions-repo.js';
import { currentYear } from '../date-util.js';
import type { FurusatoSettingsRow } from '../types.js';

function toProfileInput(s: FurusatoSettingsRow) {
  return {
    annualIncomeYen: s.annual_income_yen,
    maritalStatus: s.marital_status,
    dependentsGeneral: s.dependents_general,
    dependentsSpecific: s.dependents_specific,
    socialInsuranceRate: s.social_insurance_rate,
    otherDeductionsYen: s.other_deductions_yen,
  };
}

export function registerSuggestRoutes(r: Hono, ctx: PluginContext): void {
  r.post('/api/suggest', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const year = typeof body.year === 'number' ? Math.round(body.year) : currentYear();

    const settings = getSettings(ctx.db);
    const limit = estimateFurusatoLimit(toProfileInput(settings));
    const totalDonatedYen = yearlyTotalYen(ctx.db, year);
    const pastGifts = listGifts(ctx.db, year);
    const watchingBookmarks = listBookmarks(ctx.db, 'watching');

    const prompt = buildSuggestPrompt({ year, limit, totalDonatedYen, pastGifts, watchingBookmarks });

    try {
      const bodyMd = (await ctx.memoria.llm(prompt)).trim() || '(提案の生成に失敗しました)';
      const suggestion = saveSuggestion(ctx.db, year, bodyMd);
      return c.json({ ok: true, suggestion });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.log(`suggest failed: ${msg}`);
      return c.json({ ok: false, error: msg }, 502);
    }
  });

  r.get('/api/suggestions/latest', (c) => {
    const yearQ = c.req.query('year');
    const year = yearQ ? Number(yearQ) : currentYear();
    return c.json({ suggestion: latestSuggestion(ctx.db, year) ?? null });
  });
}
