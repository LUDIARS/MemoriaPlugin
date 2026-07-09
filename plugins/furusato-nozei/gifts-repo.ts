// furusato_nozei_gifts の CRUD + 年次集計 + 到着待ちクエリ。

import type { PluginDb } from '../../host/plugin-db.js';
import type { FurusatoGiftRow } from './types.js';
import { nowIso } from './date-util.js';

export interface GiftInput {
  year: number;
  municipality: string;
  product_name: string;
  category?: string | null;
  amount_yen: number;
  donated_at?: string | null;
  expected_ship_start?: string | null;
  expected_ship_end?: string | null;
  arrived_at?: string | null;
  source_url?: string | null;
  image_url?: string | null;
  memo?: string | null;
}

export type GiftPatch = Partial<GiftInput> & { arrived_at?: string | null };

export function listGifts(db: PluginDb, year?: number): FurusatoGiftRow[] {
  if (year !== undefined) {
    return db.all<FurusatoGiftRow>(
      `SELECT * FROM ${db.table('gifts')} WHERE year = ? ORDER BY donated_at DESC, created_at DESC`,
      year,
    );
  }
  return db.all<FurusatoGiftRow>(`SELECT * FROM ${db.table('gifts')} ORDER BY year DESC, donated_at DESC, created_at DESC`);
}

export function getGift(db: PluginDb, id: number): FurusatoGiftRow | undefined {
  return db.get<FurusatoGiftRow>(`SELECT * FROM ${db.table('gifts')} WHERE id = ?`, id);
}

export function insertGift(db: PluginDb, input: GiftInput): FurusatoGiftRow {
  const now = nowIso();
  const result = db.run(
    `INSERT INTO ${db.table('gifts')}
       (year, municipality, product_name, category, amount_yen, donated_at,
        expected_ship_start, expected_ship_end, arrived_at, source_url, image_url, memo,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.year,
    input.municipality,
    input.product_name,
    input.category ?? null,
    input.amount_yen,
    input.donated_at ?? null,
    input.expected_ship_start ?? null,
    input.expected_ship_end ?? null,
    input.arrived_at ?? null,
    input.source_url ?? null,
    input.image_url ?? null,
    input.memo ?? null,
    now,
    now,
  );
  return getGift(db, Number(result.lastInsertRowid))!;
}

const PATCHABLE_COLUMNS: Array<keyof GiftPatch> = [
  'year', 'municipality', 'product_name', 'category', 'amount_yen', 'donated_at',
  'expected_ship_start', 'expected_ship_end', 'arrived_at', 'source_url', 'image_url', 'memo',
];

export function updateGift(db: PluginDb, id: number, patch: GiftPatch): FurusatoGiftRow | undefined {
  const cols = PATCHABLE_COLUMNS.filter((c) => c in patch);
  if (cols.length === 0) return getGift(db, id);
  const assignments = cols.map((c) => `${c} = ?`).join(', ');
  const values = cols.map((c) => (patch as Record<string, unknown>)[c] ?? null);
  db.run(
    `UPDATE ${db.table('gifts')} SET ${assignments}, updated_at = ? WHERE id = ?`,
    ...values,
    nowIso(),
    id,
  );
  return getGift(db, id);
}

export function markArrived(db: PluginDb, id: number, arrivedAt: string): FurusatoGiftRow | undefined {
  return updateGift(db, id, { arrived_at: arrivedAt });
}

export function deleteGift(db: PluginDb, id: number): void {
  db.run(`DELETE FROM ${db.table('gifts')} WHERE id = ?`, id);
}

export function yearlyTotalYen(db: PluginDb, year: number): number {
  const row = db.get<{ total: number | null }>(
    `SELECT SUM(amount_yen) AS total FROM ${db.table('gifts')} WHERE year = ?`,
    year,
  );
  return row?.total ?? 0;
}

export function listDistinctYears(db: PluginDb): number[] {
  const rows = db.all<{ year: number }>(`SELECT DISTINCT year FROM ${db.table('gifts')} ORDER BY year DESC`);
  return rows.map((r) => r.year);
}

/** 発送時期を迎えていて未通知 (または未着フォロー未送) のギフト。 通知 job が使う。 */
export function listAwaitingNotification(db: PluginDb, today: string, followUpAfterDate: string): FurusatoGiftRow[] {
  return db.all<FurusatoGiftRow>(
    `SELECT * FROM ${db.table('gifts')}
      WHERE arrived_at IS NULL
        AND expected_ship_start IS NOT NULL
        AND expected_ship_start <= ?
        AND (
          notified_at IS NULL
          OR (reminded_at IS NULL AND expected_ship_end IS NOT NULL AND expected_ship_end <= ?)
        )`,
    today,
    followUpAfterDate,
  );
}

export function markNotified(db: PluginDb, id: number, atIso: string): void {
  db.run(
    `UPDATE ${db.table('gifts')} SET notified_at = COALESCE(notified_at, ?), updated_at = ? WHERE id = ?`,
    atIso,
    atIso,
    id,
  );
}

export function markReminded(db: PluginDb, id: number, atIso: string): void {
  db.run(
    `UPDATE ${db.table('gifts')} SET reminded_at = ?, updated_at = ? WHERE id = ?`,
    atIso,
    atIso,
    id,
  );
}
