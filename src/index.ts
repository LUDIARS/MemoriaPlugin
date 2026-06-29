// MemoriaPlugin サイドカーのエントリ。 プラグインを登録してホストを起動する。
// 設定はすべて env (秘密は .env.secrets 推奨)。

import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildApp } from '../host/registry.js';
import { createMemoriaClient } from '../host/memoria-client.js';
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
const plugins = await loadPlugins([BUNDLED_PLUGINS_DIR, ...externalPluginDirs]);

const app = buildApp(plugins, {
  dataDir: DATA_DIR,
  publicBaseUrl: PUBLIC_BASE,
  memoria: createMemoriaClient({ baseUrl: MEMORIA_BASE, token: PLUGIN_TOKEN }),
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
