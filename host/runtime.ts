// プラグインランタイム: 登録 + マウント + 単体ホットリロード。
//
// 各プラグインを /plugins/<id> に載せるが、 ルートは「可変 dispatcher」 経由にする:
//   app.all('/plugins/:id[/*]', dispatch) を 1 度だけ登録し、 dispatch は id から
//   現在の sub-Hono を引いて委譲する。 これにより reload 時に sub を作り直して差し替える
//   だけで、 Hono のルート削除に頼らず「プラグイン単体」 を再読込できる。
//
// reload(id):
//   1. 旧ジョブタイマーを disposer で確実に停止。
//   2. entry を ?v= 付きで再 import (ESM キャッシュ回避)。
//   3. sub/ctx/requirements/jobs を組み直し entries を差し替える。

import { Hono, type Context } from 'hono';
import type {
  MemoriaPlugin,
  PluginContext,
  PluginManifestEntry,
  PluginStatus,
} from './types.js';
import type { SqliteLike } from './sqlite.js';
import type { CapabilityProviders } from './capabilities.js';
import { createCapabilities } from './capabilities.js';
import { createSettingsStore } from './settings-store.js';
import { createPluginDb } from './plugin-db.js';
import { startJobs } from './scheduler.js';
import { detectRequirements, summarizeUnmet } from './requirements.js';
import { importPluginModule, type LoadedPlugin } from './loader.js';

interface RuntimeEntry {
  id: string;
  basePath: string;
  plugin: MemoriaPlugin;
  ctx: PluginContext;
  entryFile: string;
  dir: string;
  sub: Hono;
  disposers: Array<() => void>;
  status: PluginStatus;
  statusReason?: string;
}

export interface RegistryConfig {
  /** プラグイン設定 (secret 含む) の保存先ディレクトリ。 */
  dataDir: string;
  /** プラグイン DB アクセサ用 SQLite。 */
  sqlite: SqliteLike;
  /** host 機能 (announce / gps / diary / trend) の実装。 */
  capabilities: CapabilityProviders;
  /**
   * manifest url の生成方式。
   *  - 指定あり (サイドカー): `${publicBaseUrl}${basePath}` の絶対 url。
   *  - 省略 (本体 in-process): basePath のみの相対 url (同一オリジン iframe 用)。
   */
  publicBaseUrl?: string;
}

export interface PluginRegistry {
  /** 全プラグインの manifest (現在状態)。 */
  manifest(): PluginManifestEntry[];
  /** プラグイン単体をホットリロード。 成功で更新後 manifest、 未知 id は null。 */
  reload(id: string): Promise<PluginManifestEntry | null>;
  /** 登録 id 一覧。 */
  ids(): string[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/**
 * app に dispatcher を 1 度だけ登録し、 loaded を活性化して PluginRegistry を返す。
 */
export async function buildRegistry(
  app: Hono,
  loaded: LoadedPlugin[],
  cfg: RegistryConfig,
): Promise<PluginRegistry> {
  const entries = new Map<string, RuntimeEntry>();
  const publicBase = cfg.publicBaseUrl ? cfg.publicBaseUrl.replace(/\/+$/, '') : '';
  let reloadSeq = 0;

  function makeCtx(plugin: MemoriaPlugin, basePath: string): PluginContext {
    return {
      settings: createSettingsStore(cfg.dataDir, plugin.id),
      db: createPluginDb(cfg.sqlite, plugin.id),
      memoria: createCapabilities(plugin.id, cfg.capabilities),
      log: (msg: string) => console.log(`[${plugin.id}] ${msg}`),
      basePath,
    };
  }

  /** プラグインを活性化 (routes 登録 + requirement 判定 + jobs 起動)。 失敗は status に畳む。 */
  async function activate(item: LoadedPlugin): Promise<RuntimeEntry> {
    const { plugin, entryFile, dir } = item;
    const basePath = `/plugins/${plugin.id}`;
    const ctx = makeCtx(plugin, basePath);
    const sub = new Hono();
    let status: PluginStatus = 'ready';
    let statusReason: string | undefined;
    let disposers: Array<() => void> = [];

    try {
      // ルートは status に関わらず常に生やす (needs-setup でも設定 UI に届くように)。
      plugin.routes?.(sub, ctx);
      const req = await detectRequirements(plugin, ctx);
      if (!req.ok) {
        status = 'needs-setup';
        statusReason = summarizeUnmet(req.unmet);
        console.warn(`[host] plugin "${plugin.id}" needs-setup: ${statusReason}`);
      } else {
        disposers = startJobs(plugin, ctx);
      }
    } catch (e) {
      status = 'error';
      statusReason = errMsg(e);
      console.error(`[host] plugin "${plugin.id}" 初期化失敗: ${statusReason}`);
    }

    return { id: plugin.id, basePath, plugin, ctx, entryFile, dir, sub, disposers, status, statusReason };
  }

  function toManifest(e: RuntimeEntry): PluginManifestEntry {
    return {
      id: e.plugin.id,
      name: e.plugin.name,
      icon: e.plugin.icon,
      description: e.plugin.description ?? '',
      url: `${publicBase}${e.basePath}`,
      status: e.status,
      statusReason: e.statusReason,
    };
  }

  // dispatcher: id から現在の sub を引き、 basePath を剥がして委譲する。
  async function dispatch(c: Context): Promise<Response> {
    const id = c.req.param('id');
    const e = id ? entries.get(id) : undefined;
    if (!e) return c.notFound();
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(e.basePath.length) || '/';
    return e.sub.fetch(new Request(url.toString(), c.req.raw));
  }

  for (const item of loaded) {
    const e = await activate(item);
    entries.set(e.id, e);
    console.log(`[host] mounted plugin "${e.id}" at ${e.basePath} (status=${e.status})`);
  }

  app.all('/plugins/:id', dispatch);
  app.all('/plugins/:id/*', dispatch);

  return {
    manifest: () => [...entries.values()].map(toManifest),
    ids: () => [...entries.keys()],
    async reload(id: string): Promise<PluginManifestEntry | null> {
      const prev = entries.get(id);
      if (!prev) return null;
      for (const dispose of prev.disposers) {
        try {
          dispose();
        } catch (e) {
          console.error(`[host] plugin "${id}" のタイマー停止失敗: ${errMsg(e)}`);
        }
      }
      reloadSeq += 1;
      const fresh = await importPluginModule(prev.entryFile, `${Date.now()}-${reloadSeq}`);
      const next = await activate({ plugin: fresh, entryFile: prev.entryFile, dir: prev.dir });
      entries.set(id, next);
      console.log(`[host] reloaded plugin "${id}" (status=${next.status})`);
      return toManifest(next);
    },
  };
}
