// プラグインホストの公開インターフェース。
// 「いろいろな機能を接続できる」ための最小契約。 各プラグインは MemoriaPlugin を
// 1 つ default export し、 src/index.ts の registry に登録する。

import type { Hono } from 'hono';
import type { SettingsStore } from './settings-store.js';
import type { MemoriaClient } from './memoria-client.js';

/** プラグインに渡る実行コンテキスト。 */
export interface PluginContext {
  /** このプラグイン専用の設定ストア (secret 含む、 ローカルのみ)。 */
  settings: SettingsStore;
  /** Memoria 本体の機能 (announce 等) を呼ぶクライアント。 */
  memoria: MemoriaClient;
  /** プレフィックス付きロガー。 */
  log: (msg: string) => void;
  /** このプラグインの公開ベースパス (例 "/plugins/private-transit")。 */
  basePath: string;
}

/** 定期実行ジョブ。 run 内部で時間帯判定を行う (ホストは intervalMs ごとに呼ぶだけ)。 */
export interface PluginJob {
  id: string;
  /** 起動間隔 (ms)。 時間帯フィルタは run 側の責務。 */
  intervalMs: number;
  run: (ctx: PluginContext) => Promise<void>;
}

/** プラグイン定義。 */
export interface MemoriaPlugin {
  id: string;
  /** Memoria の「ユーザーアプリ」タブに子として出る表示名。 */
  name: string;
  /** 絵文字 1 文字想定のアイコン。 */
  icon: string;
  description?: string;
  /**
   * HTTP ルートを登録する。 r は basePath 配下にマウント済みの Hono。
   * UI ("/") と API ("/api/...") をここに生やす。
   */
  routes?: (r: Hono, ctx: PluginContext) => void;
  /** 定期ジョブ。 */
  jobs?: PluginJob[];
}

/** Memoria が読む manifest の 1 エントリ。 */
export interface PluginManifestEntry {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Memoria の iframe が指す UI URL (ホスト絶対 URL)。 */
  url: string;
}
