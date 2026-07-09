// GET/POST/PATCH/DELETE /api/gifts + /api/summary — 返礼品の記録・年次集計。

import type { Hono } from 'hono';
import type { PluginContext } from '../../../host/types.js';
import {
  listGifts, getGift, insertGift, updateGift, deleteGift, yearlyTotalYen, listDistinctYears,
  type GiftInput, type GiftPatch,
} from '../gifts-repo.js';
import { getSettings } from '../settings-repo.js';
import { estimateFurusatoLimit } from '../simulate.js';
import { currentYear, todayLocal } from '../date-util.js';
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

function parseGiftInput(body: Record<string, unknown>): GiftInput | null {
  const municipality = typeof body.municipality === 'string' ? body.municipality.trim() : '';
  const productName = typeof body.product_name === 'string' ? body.product_name.trim() : '';
  const amountYen = typeof body.amount_yen === 'number' ? Math.round(body.amount_yen) : NaN;
  if (!municipality || !productName || !Number.isFinite(amountYen) || amountYen <= 0) return null;
  const year = typeof body.year === 'number' ? Math.round(body.year) : currentYear();
  return {
    year,
    municipality,
    product_name: productName,
    category: typeof body.category === 'string' ? body.category : null,
    amount_yen: amountYen,
    donated_at: typeof body.donated_at === 'string' ? body.donated_at : todayLocal(),
    expected_ship_start: typeof body.expected_ship_start === 'string' ? body.expected_ship_start : null,
    expected_ship_end: typeof body.expected_ship_end === 'string' ? body.expected_ship_end : null,
    arrived_at: typeof body.arrived_at === 'string' ? body.arrived_at : null,
    source_url: typeof body.source_url === 'string' ? body.source_url : null,
    image_url: typeof body.image_url === 'string' ? body.image_url : null,
    memo: typeof body.memo === 'string' ? body.memo : null,
  };
}

function parseGiftPatch(body: Record<string, unknown>): GiftPatch {
  const patch: GiftPatch = {};
  const strFields = [
    'municipality', 'product_name', 'category', 'donated_at',
    'expected_ship_start', 'expected_ship_end', 'arrived_at', 'source_url', 'image_url', 'memo',
  ] as const;
  for (const f of strFields) {
    if (typeof body[f] === 'string' || body[f] === null) (patch as Record<string, unknown>)[f] = body[f];
  }
  if (typeof body.year === 'number') patch.year = Math.round(body.year);
  if (typeof body.amount_yen === 'number') patch.amount_yen = Math.round(body.amount_yen);
  return patch;
}

export function registerGiftsRoutes(r: Hono, ctx: PluginContext): void {
  r.get('/api/gifts', (c) => {
    const yearQ = c.req.query('year');
    const year = yearQ ? Number(yearQ) : undefined;
    return c.json({ gifts: listGifts(ctx.db, Number.isFinite(year as number) ? year : undefined) });
  });

  r.post('/api/gifts', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parseGiftInput(body);
    if (!input) return c.json({ ok: false, error: 'municipality / product_name / amount_yen は必須' }, 400);
    const gift = insertGift(ctx.db, input);
    ctx.memoria.trend({ series: 'furusato_donation_yen', value: gift.amount_yen });
    return c.json({ ok: true, gift });
  });

  r.get('/api/gifts/:id', (c) => {
    const gift = getGift(ctx.db, Number(c.req.param('id')));
    if (!gift) return c.json({ ok: false, error: 'not found' }, 404);
    return c.json({ gift });
  });

  r.patch('/api/gifts/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const gift = updateGift(ctx.db, id, parseGiftPatch(body));
    if (!gift) return c.json({ ok: false, error: 'not found' }, 404);
    return c.json({ ok: true, gift });
  });

  r.delete('/api/gifts/:id', (c) => {
    deleteGift(ctx.db, Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  r.get('/api/summary', (c) => {
    const yearQ = c.req.query('year');
    const year = yearQ ? Number(yearQ) : currentYear();
    const settings = getSettings(ctx.db);
    const limit = estimateFurusatoLimit(toProfileInput(settings));
    const totalDonatedYen = yearlyTotalYen(ctx.db, year);
    return c.json({
      year,
      totalDonatedYen,
      limitYen: limit.limitYen,
      remainingYen: Math.max(limit.limitYen - totalDonatedYen, 0),
      years: listDistinctYears(ctx.db),
    });
  });
}
