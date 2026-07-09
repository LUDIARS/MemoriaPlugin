// furusato_nozei_bookmarks の CRUD。 Chrome 拡張からの取り込み先 + 「気になる」管理。

import type { PluginDb } from '../../host/plugin-db.js';
import type { FurusatoBookmarkRow, FurusatoBookmarkStatus } from './types.js';
import { nowIso } from './date-util.js';

export interface BookmarkInput {
  site?: string | null;
  municipality?: string | null;
  product_name: string;
  amount_yen?: number | null;
  url: string;
  image_url?: string | null;
  category?: string | null;
  memo?: string | null;
}

export function listBookmarks(db: PluginDb, status?: FurusatoBookmarkStatus): FurusatoBookmarkRow[] {
  if (status) {
    return db.all<FurusatoBookmarkRow>(
      `SELECT * FROM ${db.table('bookmarks')} WHERE status = ? ORDER BY created_at DESC`,
      status,
    );
  }
  return db.all<FurusatoBookmarkRow>(`SELECT * FROM ${db.table('bookmarks')} ORDER BY created_at DESC`);
}

export function getBookmark(db: PluginDb, id: number): FurusatoBookmarkRow | undefined {
  return db.get<FurusatoBookmarkRow>(`SELECT * FROM ${db.table('bookmarks')} WHERE id = ?`, id);
}

/** 同一 URL の watching 済みブックマークがあれば重複登録しない (拡張から連打されても安全)。 */
export function findWatchingByUrl(db: PluginDb, url: string): FurusatoBookmarkRow | undefined {
  return db.get<FurusatoBookmarkRow>(
    `SELECT * FROM ${db.table('bookmarks')} WHERE url = ? AND status = 'watching'`,
    url,
  );
}

export function insertBookmark(db: PluginDb, input: BookmarkInput): FurusatoBookmarkRow {
  const existing = findWatchingByUrl(db, input.url);
  if (existing) return existing;
  const result = db.run(
    `INSERT INTO ${db.table('bookmarks')}
       (site, municipality, product_name, amount_yen, url, image_url, category, memo, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'watching', ?)`,
    input.site ?? null,
    input.municipality ?? null,
    input.product_name,
    input.amount_yen ?? null,
    input.url,
    input.image_url ?? null,
    input.category ?? null,
    input.memo ?? null,
    nowIso(),
  );
  return getBookmark(db, Number(result.lastInsertRowid))!;
}

export interface BookmarkPatch {
  status?: FurusatoBookmarkStatus;
  memo?: string | null;
  converted_gift_id?: number | null;
}

export function updateBookmark(db: PluginDb, id: number, patch: BookmarkPatch): FurusatoBookmarkRow | undefined {
  const cols = Object.keys(patch) as Array<keyof BookmarkPatch>;
  if (cols.length === 0) return getBookmark(db, id);
  const assignments = cols.map((c) => `${c} = ?`).join(', ');
  const values = cols.map((c) => patch[c] ?? null);
  db.run(`UPDATE ${db.table('bookmarks')} SET ${assignments} WHERE id = ?`, ...values, id);
  return getBookmark(db, id);
}

export function deleteBookmark(db: PluginDb, id: number): void {
  db.run(`DELETE FROM ${db.table('bookmarks')} WHERE id = ?`, id);
}
