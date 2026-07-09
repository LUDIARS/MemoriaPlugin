// GET/POST /api/settings — 年収・家族構成の入力とシミュレーション結果を返す。

import type { Hono } from 'hono';
import type { PluginContext } from '../../../host/types.js';
import { getSettings, saveSettings, type SettingsPatch } from '../settings-repo.js';
import { estimateFurusatoLimit, type FurusatoProfileInput } from '../simulate.js';
import type { MaritalStatus } from '../types.js';
import type { FurusatoSettingsRow } from '../types.js';

function toProfileInput(s: FurusatoSettingsRow): FurusatoProfileInput {
  return {
    annualIncomeYen: s.annual_income_yen,
    maritalStatus: s.marital_status,
    dependentsGeneral: s.dependents_general,
    dependentsSpecific: s.dependents_specific,
    socialInsuranceRate: s.social_insurance_rate,
    otherDeductionsYen: s.other_deductions_yen,
  };
}

function parsePatch(body: Record<string, unknown>): SettingsPatch {
  const patch: SettingsPatch = {};
  if (typeof body.annual_income_yen === 'number') patch.annual_income_yen = Math.max(0, Math.round(body.annual_income_yen));
  if (body.marital_status === 'single' || body.marital_status === 'spouse_deduction') {
    patch.marital_status = body.marital_status as MaritalStatus;
  }
  if (typeof body.dependents_general === 'number') patch.dependents_general = Math.max(0, Math.round(body.dependents_general));
  if (typeof body.dependents_specific === 'number') patch.dependents_specific = Math.max(0, Math.round(body.dependents_specific));
  if (typeof body.social_insurance_rate === 'number') patch.social_insurance_rate = Math.min(0.3, Math.max(0, body.social_insurance_rate));
  if (typeof body.other_deductions_yen === 'number') patch.other_deductions_yen = Math.max(0, Math.round(body.other_deductions_yen));
  return patch;
}

export function registerSettingsRoutes(r: Hono, ctx: PluginContext): void {
  r.get('/api/settings', (c) => {
    const settings = getSettings(ctx.db);
    return c.json({ settings, limit: estimateFurusatoLimit(toProfileInput(settings)) });
  });

  r.post('/api/settings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const settings = saveSettings(ctx.db, parsePatch(body));
    return c.json({ settings, limit: estimateFurusatoLimit(toProfileInput(settings)) });
  });

  // 保存せずに試算だけしたい (what-if) 用。
  r.post('/api/simulate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const base = getSettings(ctx.db);
    const patch = parsePatch(body);
    const merged: FurusatoSettingsRow = { ...base, ...patch };
    return c.json({ limit: estimateFurusatoLimit(toProfileInput(merged)) });
  });
}
