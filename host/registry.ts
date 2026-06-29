// プラグインの登録・マウント・manifest 生成。
// 各プラグインは /plugins/<id> 配下にルートを持つ。
//
// 2 つの消費形態を共通の mountPlugins() で支える:
//  - サイドカー単体 (buildApp): 専用 Hono を建て /manifest を公開 (絶対 url)。
//  - Memoria 本体 in-process: 本体の Hono に直接マウント (相対 url、 同一オリジン)。

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { MemoriaPlugin, PluginContext, PluginManifestEntry } from './types.js';
import { createSettingsStore } from './settings-store.js';
import type { MemoriaClient } from './memoria-client.js';
import { startJobs } from './scheduler.js';

export interface MountConfig {
  /** プラグイン設定 (secret 含む) の保存先ディレクトリ。 */
  dataDir: string;
  /** Memoria 本体機能 (announce 等) を呼ぶクライアント。 */
  memoria: MemoriaClient;
  /**
   * manifest url の生成方式。
   *  - 指定あり (サイドカー): `${publicBaseUrl}${basePath}` の絶対 url。
   *  - 省略 (本体 in-process): basePath のみの相対 url (同一オリジン iframe 用)。
   */
  publicBaseUrl?: string;
}

/**
 * 既存の Hono app に各プラグインを /plugins/<id> でマウントする (in-process / サイドカー共通)。
 * - PluginContext を組み、 routes を sub app に登録 → app.route。
 * - 末尾スラッシュ版は無スラッシュへ寄せる。
 * - jobs を起動。
 * - manifest エントリ (url は publicBaseUrl 有無で絶対/相対) を返す。
 */
export function mountPlugins(
  app: Hono,
  plugins: MemoriaPlugin[],
  cfg: MountConfig,
): PluginManifestEntry[] {
  const manifest: PluginManifestEntry[] = [];
  const publicBase = cfg.publicBaseUrl ? cfg.publicBaseUrl.replace(/\/+$/, '') : '';

  for (const plugin of plugins) {
    const basePath = `/plugins/${plugin.id}`;
    const ctx: PluginContext = {
      settings: createSettingsStore(cfg.dataDir, plugin.id),
      memoria: cfg.memoria,
      log: (msg: string) => console.log(`[${plugin.id}] ${msg}`),
      basePath,
    };

    const sub = new Hono();
    plugin.routes?.(sub, ctx);
    app.route(basePath, sub);
    // 末尾スラッシュ版は無スラッシュ (sub の '/' がマッチする形) へ寄せる。
    app.get(`${basePath}/`, (c) => c.redirect(basePath));
    startJobs(plugin, ctx);

    manifest.push({
      id: plugin.id,
      name: plugin.name,
      icon: plugin.icon,
      description: plugin.description ?? '',
      url: `${publicBase}${basePath}`,
    });
    console.log(`[host] mounted plugin "${plugin.id}" at ${basePath}`);
  }
  return manifest;
}

export interface RegistryConfig {
  dataDir: string;
  memoria: MemoriaClient;
  /** ホスト自身の公開ベース URL (manifest の絶対 url 生成用)。 */
  publicBaseUrl: string;
}

/**
 * サイドカー単体用に Hono アプリを丸ごと組む (manifest + 各プラグインルート)。
 * Memoria の「ユーザーアプリ」タブはこの manifest を読み、 各 url を iframe で子表示する。
 */
export function buildApp(plugins: MemoriaPlugin[], cfg: RegistryConfig): Hono {
  const app = new Hono();
  app.use('*', cors({ origin: '*' }));

  const manifest = mountPlugins(app, plugins, cfg);

  app.get('/manifest', (c) => c.json({ plugins: manifest }));
  app.get('/', (c) => c.json({ ok: true, plugins: manifest.map((m) => m.id) }));

  return app;
}
