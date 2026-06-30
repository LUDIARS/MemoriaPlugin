// プラグインホストの公開インターフェース。
// 「いろいろな機能を接続できる」ための契約。 各プラグインは MemoriaPlugin を
// 1 つ default export し、 plugins/ または外部フォルダに置く。

import type { Hono } from 'hono';
import type { SettingsStore } from './settings-store.js';
import type { HostCapabilities } from './capabilities.js';
import type { PluginDb } from './plugin-db.js';

/** プラグインに渡る実行コンテキスト。 */
export interface PluginContext {
  /** このプラグイン専用の設定ストア (secret 含む、 ローカルのみ)。 */
  settings: SettingsStore;
  /** 自プラグイン専用 SQLite アクセサ (prefix テーブル read/write + 他テーブル read-only)。 */
  db: PluginDb;
  /** Memoria 本体機能 (Discord通知 / GPS / 日記出力 / 傾向出力)。 */
  memoria: HostCapabilities;
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

/**
 * 外部インストール物などの「前提条件」。 host がマウント時に detect() を走らせ、
 * 未充足なら status='needs-setup' でマウントする (jobs は起動しない)。
 */
export interface PluginRequirement {
  /** 安定 id (例 "tshark")。 */
  id: string;
  /** 表示名 (例 "Wireshark (tshark)")。 */
  label: string;
  /** 充足方法のヒント (インストール手順 / 設定キー)。 */
  hint?: string;
  /** 利用可能なら true。 例外は未充足扱い。 */
  detect: (ctx: PluginContext) => Promise<boolean>;
}

export type PluginStatus = 'ready' | 'needs-setup' | 'error';

/** プラグイン定義。 */
export interface MemoriaPlugin {
  id: string;
  /** Memoria の「ユーザーアプリ」タブに子として出る表示名。 */
  name: string;
  /** 絵文字 1 文字想定のアイコン。 */
  icon: string;
  description?: string;
  /** 外部依存 (要インストール物等) の前提条件。 */
  requirements?: PluginRequirement[];
  /**
   * HTTP ルートを登録する。 r は basePath 配下にマウント済みの Hono。
   * UI ("/") と API ("/api/...") をここに生やす。
   */
  routes?: (r: Hono, ctx: PluginContext) => void;
  /** 定期ジョブ (ライフサイクル)。 */
  jobs?: PluginJob[];
}

/** Memoria が読む manifest の 1 エントリ。 */
export interface PluginManifestEntry {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Memoria の iframe が指す UI URL (絶対/相対)。 */
  url: string;
  /** 稼働状態。 needs-setup は前提条件未充足。 */
  status: PluginStatus;
  /** needs-setup/error の理由 (未充足 requirement のラベル等)。 */
  statusReason?: string;
}
