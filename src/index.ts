// MemoriaPlugin サイドカーのエントリ。 プラグインを登録してホストを起動する。
// 設定はすべて env (秘密は .env.secrets 推奨)。
//
// 注意: サイドカー単体では本体 SQLite に届かないため ctx.db / GPS / 日記 / 傾向は
// 非対応 (使うと throw)。 これらを使うプラグインは本体 in-process マウントで動かすこと。

import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildApp } from '../host/registry.js';
import { createHttpProviders } from '../host/capabilities.js';
import { createUnavailableSqlite } from '../host/sqlite.js';
import { loadPlugins, resolveExternalPluginDirs } from '../host/loader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = Number(process.env.MEMORIA_PLUGIN_PORT) || 5191;
const PUBLIC_BASE = process.env.MEMORIA_PLUGIN_PUBLIC_URL || `http://localhost:${PORT}`;
const MEMORIA_BASE = process.env.MEMORIA_BASE_URL || 'http://localhost:5180';
const PLUGIN_TOKEN = process.env.MEMORIA_PLUGIN_TOKEN || '';
const DATA_DIR = process.env.MEMORIA_PLUGIN_DATA || join(ROOT, 'data');

// 同梱 plugins/ (共有) を先に、 外部フォルダ (MEMORIA_PLUGINS_DIR, ユーザカスタム) を
// 後に走査する → 同 id は外部が上書き (ユーザカスタム優先)。
const BUNDLED_PLUGINS_DIR = join(ROOT, 'plugins');
const externalPluginDirs = resolveExternalPluginDirs();
const loaded = await loadPlugins([BUNDLED_PLUGINS_DIR, ...externalPluginDirs]);

const app = await buildApp(loaded, {
  dataDir: DATA_DIR,
  publicBaseUrl: PUBLIC_BASE,
  sqlite: createUnavailableSqlite('サイドカーでは ctx.db (SQLite) 非対応 — 本体 in-process マウントで利用すること'),
  capabilities: createHttpProviders({ baseUrl: MEMORIA_BASE, token: PLUGIN_TOKEN }),
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[host] MemoriaPlugin listening on http://localhost:${info.port}`);
  console.log(`[host] manifest: http://localhost:${info.port}/manifest`);
  console.log(`[host] data dir: ${DATA_DIR}`);
  console.log(
    externalPluginDirs.length
      ? `[host] external plugin dirs (MEMORIA_PLUGINS_DIR): ${externalPluginDirs.join(', ')}`
      : '[host] external plugin dirs: none (同梱 plugins/ のみ)',
  );
  if (!PLUGIN_TOKEN) console.warn('[host] MEMORIA_PLUGIN_TOKEN 未設定 — announce は Memoria 側で拒否される');
});
