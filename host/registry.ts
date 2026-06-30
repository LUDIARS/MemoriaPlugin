// プラグインの登録・マウント・manifest 生成。
// 各プラグインは /plugins/<id> 配下にルートを持つ (可変 dispatcher 経由 → runtime.ts)。
//
// 2 つの消費形態を共通の buildRegistry() で支える:
//  - サイドカー単体 (buildApp): 専用 Hono を建て /manifest を公開 (絶対 url)。
//  - Memoria 本体 in-process: 本体の Hono に直接マウント (相対 url、 同一オリジン)。

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { PluginManifestEntry } from './types.js';
import type { LoadedPlugin } from './loader.js';
import { buildRegistry, type PluginRegistry, type RegistryConfig } from './runtime.js';

export type { PluginRegistry, RegistryConfig } from './runtime.js';

export interface MountResult {
  manifest: PluginManifestEntry[];
  registry: PluginRegistry;
}

/**
 * 既存の Hono app に各プラグインをマウントする (in-process / サイドカー共通)。
 * dispatcher 登録・PluginContext 構築・jobs 起動は runtime.buildRegistry に委譲し、
 * ここは「初期 manifest と registry を返す」 薄いラッパ。
 */
export async function mountPlugins(
  app: Hono,
  loaded: LoadedPlugin[],
  cfg: RegistryConfig,
): Promise<MountResult> {
  const registry = await buildRegistry(app, loaded, cfg);
  return { manifest: registry.manifest(), registry };
}

/**
 * サイドカー単体用に Hono アプリを丸ごと組む (manifest + 各プラグインルート)。
 * Memoria の「ユーザーアプリ」タブはこの manifest を読み、 各 url を iframe で子表示する。
 */
export async function buildApp(loaded: LoadedPlugin[], cfg: RegistryConfig): Promise<Hono> {
  const app = new Hono();
  app.use('*', cors({ origin: '*' }));

  const { registry } = await mountPlugins(app, loaded, cfg);

  app.get('/manifest', (c) => c.json({ plugins: registry.manifest() }));
  app.get('/', (c) => c.json({ ok: true, plugins: registry.ids() }));
  // プラグイン単体ホットリロード (サイドカーでも使えるように)。
  app.post('/reload/:id', async (c) => {
    const updated = await registry.reload(c.req.param('id'));
    if (!updated) return c.json({ ok: false, error: 'unknown plugin' }, 404);
    return c.json({ ok: true, plugin: updated });
  });

  return app;
}
