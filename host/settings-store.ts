// プラグインごとのローカル設定ストア。 data/<pluginId>.json に保存する。
// secret (private-transit-service の Basic 認証パスワード等) もここに入るため:
//   - data/ は .gitignore 済 (コミットされない / LUDIARS 共有 DB に流れない)
//   - per-user / ローカルマシン限定 ([[feedback_secret_per_user_memory_only]] の精神)
//   - 値はログに出さない (toJSON で secret キーをマスクするのは呼び出し側責務)
// 平文 JSON である点は「ローカル個人ツール」 前提のトレードオフ。 リポには出ない。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SettingsStore {
  get<T = unknown>(key: string): T | undefined;
  getString(key: string, fallback?: string): string;
  set(values: Record<string, unknown>): void;
  all(): Record<string, unknown>;
}

export function createSettingsStore(dataDir: string, pluginId: string): SettingsStore {
  const file = join(dataDir, `${pluginId}.json`);

  function load(): Record<string, unknown> {
    if (!existsSync(file)) return {};
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      // 壊れた設定は握りつぶさず明示 ([[feedback_no_error_swallow]])。
      throw new Error(`settings 読込失敗 ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function save(data: Record<string, unknown>): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    get<T = unknown>(key: string): T | undefined {
      return load()[key] as T | undefined;
    },
    getString(key: string, fallback = ''): string {
      const v = load()[key];
      return typeof v === 'string' ? v : fallback;
    },
    set(values: Record<string, unknown>): void {
      save({ ...load(), ...values });
    },
    all(): Record<string, unknown> {
      return load();
    },
  };
}
