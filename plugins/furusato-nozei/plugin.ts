import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Hono } from 'hono';
import type { MemoriaPlugin, PluginContext } from '../../host/types.js';
import { ensureSchema } from './schema.js';
import { registerSettingsRoutes } from './routes/settings-routes.js';
import { registerGiftsRoutes } from './routes/gifts-routes.js';
import { registerBookmarksRoutes } from './routes/bookmarks-routes.js';
import { registerSuggestRoutes } from './routes/suggest-routes.js';
import { arrivalWatch } from './jobs/arrival-watch.js';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), 'ui');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function registerRoutes(r: Hono, ctx: PluginContext): void {
  ensureSchema(ctx.db);

  r.get('/', (c) => {
    const html = readFileSync(join(UI_DIR, 'index.html'), 'utf8').replaceAll('__BASE_PATH__', ctx.basePath);
    return c.html(html);
  });
  r.get('/app.js', (c) =>
    c.body(readFileSync(join(UI_DIR, 'app.js'), 'utf8'), 200, {
      'content-type': 'text/javascript; charset=utf-8',
    }),
  );

  registerSettingsRoutes(r, ctx);
  registerGiftsRoutes(r, ctx);
  registerBookmarksRoutes(r, ctx);
  registerSuggestRoutes(r, ctx);
}

const plugin: MemoriaPlugin = {
  id: 'furusato-nozei',
  name: 'ふるさと納税',
  icon: '🎁',
  description: '控除上限シミュレーション・返礼品管理・AIサジェスト・発送通知',
  routes: registerRoutes,
  jobs: [{ id: 'arrival-watch', intervalMs: SIX_HOURS_MS, run: arrivalWatch }],
};

export default plugin;
