// 一過性スモーク: ポートを開かず app.request で骨格エンドポイントを確認する。
// 同梱プラグインは無い (フレームワークのみ)。 plugins/ や MEMORIA_PLUGINS_DIR に
// プラグインを置くと /manifest に並ぶ。 サイドカー文脈なので ctx.db は非対応スタブ。
import { join } from 'node:path';
import { buildApp } from '../host/registry.js';
import { createHttpProviders } from '../host/capabilities.js';
import { createUnavailableSqlite } from '../host/sqlite.js';
import { loadPlugins, resolveExternalPluginDirs } from '../host/loader.js';

const dirs = [join(process.cwd(), 'plugins'), ...resolveExternalPluginDirs()];
const loaded = await loadPlugins(dirs);
const app = await buildApp(loaded, {
  dataDir: join(process.cwd(), 'data'),
  publicBaseUrl: 'http://localhost:5191',
  sqlite: createUnavailableSqlite('smoke: ctx.db (SQLite) はサイドカー非対応'),
  capabilities: createHttpProviders({ baseUrl: 'http://localhost:5180', token: '' }),
});

async function hit(path: string, init?: RequestInit): Promise<void> {
  const res = await app.request(path, init);
  const ct = res.headers.get('content-type') || '';
  const preview = ct.includes('json') ? JSON.stringify(await res.json()) : `(${ct}, ${(await res.text()).length} bytes)`;
  console.log(`${String(res.status).padEnd(4)} ${path.padEnd(34)} ${preview.slice(0, 160)}`);
}

console.log(`loaded ${loaded.length} plugin(s): ${loaded.map((l) => l.plugin.id).join(', ') || '(none)'}`);
await hit('/');
await hit('/manifest');
process.exit(0);
