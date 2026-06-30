// プラグインの登録・マウント・manifest 生成。
// 各プラグインは /plugins/<id> 配下にルートを持つ (可変 dispatcher 経由 → runtime.ts)。
//
// Memoria 本体 in-process 専用: 本体の Hono に直接マウントする (相対 url、 同一オリジン)。

import type { Hono } from 'hono';
import type { PluginManifestEntry } from './types.js';
import type { LoadedPlugin } from './loader.js';
import { buildRegistry, type PluginRegistry, type RegistryConfig } from './runtime.js';

export type { PluginRegistry, RegistryConfig } from './runtime.js';

export interface MountResult {
  manifest: PluginManifestEntry[];
  registry: PluginRegistry;
}

/**
 * 既存の Hono app (Memoria 本体) に各プラグインをマウントする。
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
