// 一過性スモーク: ポートを開かず app.request で骨格エンドポイントを確認する。
// 同梱プラグインは無い (フレームワークのみ)。 plugins/ や MEMORIA_PLUGINS_DIR に
// プラグインを置くと /manifest に並ぶ。
import { join } from 'node:path';
import { buildApp } from '../host/registry.js';
import { createMemoriaClient } from '../host/memoria-client.js';
import { loadPlugins, resolveExternalPluginDirs } from '../host/loader.js';

const dirs = [join(process.cwd(), 'plugins'), ...resolveExternalPluginDirs()];
const plugins = await loadPlugins(dirs);
const app = buildApp(plugins, {
  dataDir: join(process.cwd(), 'data'),
  publicBaseUrl: 'http://localhost:5191',
  memoria: createMemoriaClient({ baseUrl: 'http://localhost:5180', token: '' }),
});

async function hit(path: string, init?: RequestInit): Promise<void> {
  const res = await app.request(path, init);
  const ct = res.headers.get('content-type') || '';
  const preview = ct.includes('json') ? JSON.stringify(await res.json()) : `(${ct}, ${(await res.text()).length} bytes)`;
  console.log(`${String(res.status).padEnd(4)} ${path.padEnd(34)} ${preview.slice(0, 160)}`);
}

console.log(`loaded ${plugins.length} plugin(s): ${plugins.map((p) => p.id).join(', ') || '(none)'}`);
await hit('/');
await hit('/manifest');
process.exit(0);
