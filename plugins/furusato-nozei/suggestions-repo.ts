// furusato_nozei_suggestions の read/write。 サジェストボタンの結果を保存し、
// 画面再読込後も直近の提案を表示できるようにする。

import type { PluginDb } from '../../host/plugin-db.js';
import type { FurusatoSuggestionRow } from './types.js';
import { nowIso } from './date-util.js';

export function saveSuggestion(db: PluginDb, year: number, bodyMd: string): FurusatoSuggestionRow {
  const result = db.run(
    `INSERT INTO ${db.table('suggestions')} (year, body_md, created_at) VALUES (?, ?, ?)`,
    year,
    bodyMd,
    nowIso(),
  );
  return db.get<FurusatoSuggestionRow>(
    `SELECT * FROM ${db.table('suggestions')} WHERE id = ?`,
    Number(result.lastInsertRowid),
  )!;
}

export function latestSuggestion(db: PluginDb, year: number): FurusatoSuggestionRow | undefined {
  return db.get<FurusatoSuggestionRow>(
    `SELECT * FROM ${db.table('suggestions')} WHERE year = ? ORDER BY created_at DESC LIMIT 1`,
    year,
  );
}
