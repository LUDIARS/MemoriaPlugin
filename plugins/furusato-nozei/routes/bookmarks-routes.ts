// GET/POST/PATCH/DELETE /api/bookmarks — Chrome拡張からの取り込み先 + 「気になる」管理。
// PATCH で status='donated' + gift フィールドを渡すと返礼品へ変換する。

import type { Hono } from 'hono';
import type { PluginContext } from '../../../host/types.js';
import {
  listBookmarks, getBookmark, insertBookmark, updateBookmark, deleteBookmark,
  type BookmarkInput,
} from '../bookmarks-repo.js';
import { insertGift } from '../gifts-repo.js';
import { currentYear, todayLocal } from '../date-util.js';
import type { FurusatoBookmarkStatus } from '../types.js';

function parseBookmarkInput(body: Record<string, unknown>): BookmarkInput | null {
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const productName = typeof body.product_name === 'string' ? body.product_name.trim() : '';
  if (!url || !productName) return null;
  return {
    site: typeof body.site === 'string' ? body.site : null,
    municipality: typeof body.municipality === 'string' ? body.municipality : null,
    product_name: productName,
    amount_yen: typeof body.amount_yen === 'number' ? Math.round(body.amount_yen) : null,
    url,
    image_url: typeof body.image_url === 'string' ? body.image_url : null,
    category: typeof body.category === 'string' ? body.category : null,
    memo: typeof body.memo === 'string' ? body.memo : null,
  };
}

const VALID_STATUS = new Set<FurusatoBookmarkStatus>(['watching', 'donated', 'dismissed']);

export function registerBookmarksRoutes(r: Hono, ctx: PluginContext): void {
  r.get('/api/bookmarks', (c) => {
    const statusQ = c.req.query('status');
    const status = statusQ && VALID_STATUS.has(statusQ as FurusatoBookmarkStatus) ? (statusQ as FurusatoBookmarkStatus) : undefined;
    return c.json({ bookmarks: listBookmarks(ctx.db, status) });
  });

  // Chrome拡張 (Memoria/extension) からの主要エントリポイント。
  r.post('/api/bookmarks', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parseBookmarkInput(body);
    if (!input) return c.json({ ok: false, error: 'url / product_name は必須' }, 400);
    const bookmark = insertBookmark(ctx.db, input);
    ctx.log(`bookmark saved: ${bookmark.product_name} (${bookmark.url})`);
    return c.json({ ok: true, bookmark });
  });

  r.patch('/api/bookmarks/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.status === 'donated' && typeof body.amount_yen === 'number') {
      const bm = getBookmark(ctx.db, id);
      if (!bm) return c.json({ ok: false, error: 'not found' }, 404);
      const gift = insertGift(ctx.db, {
        year: typeof body.year === 'number' ? Math.round(body.year) : currentYear(),
        municipality: (typeof body.municipality === 'string' && body.municipality) || bm.municipality || '不明',
        product_name: bm.product_name,
        category: bm.category,
        amount_yen: Math.round(body.amount_yen),
        donated_at: typeof body.donated_at === 'string' ? body.donated_at : todayLocal(),
        expected_ship_start: typeof body.expected_ship_start === 'string' ? body.expected_ship_start : null,
        expected_ship_end: typeof body.expected_ship_end === 'string' ? body.expected_ship_end : null,
        source_url: bm.url,
        image_url: bm.image_url,
        memo: bm.memo,
      });
      const bookmark = updateBookmark(ctx.db, id, { status: 'donated', converted_gift_id: gift.id });
      return c.json({ ok: true, bookmark, gift });
    }

    const status = VALID_STATUS.has(body.status as FurusatoBookmarkStatus) ? (body.status as FurusatoBookmarkStatus) : undefined;
    const bookmark = updateBookmark(ctx.db, id, {
      status,
      memo: typeof body.memo === 'string' ? body.memo : undefined,
    });
    if (!bookmark) return c.json({ ok: false, error: 'not found' }, 404);
    return c.json({ ok: true, bookmark });
  });

  r.delete('/api/bookmarks/:id', (c) => {
    deleteBookmark(ctx.db, Number(c.req.param('id')));
    return c.json({ ok: true });
  });
}
