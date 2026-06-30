// プラグインの動的読み込み。 Concordia の reaction-workflow-loader と同じ
// 「外部フォルダ優先 + 同梱フォールバック」 方式。
//
// 複数の plugins ディレクトリを優先順に走査し、 各サブフォルダの plugin.ts
// (なければ plugin.js) を実行時に await import() して default export を集める。
//  - 同梱 (リポ内 plugins/) は共有プラグイン。
//  - 個人フォルダは本体が固定パスで渡す隣接リポ (../MemoriaPlugin-Local/plugins)。
//    リポ外に置き push しない (各自ローカルで足す)。 同じ id があれば後に走査した
//    個人フォルダが上書きする (ユーザカスタム優先)。
// 静的な import 列挙が不要で、 フォルダを足すだけで増える。
//
// 読み込み結果には entry ファイルパスを含める → ホットリロードで再 import するため。

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MemoriaPlugin } from './types.js';

export interface LoadedPlugin {
  plugin: MemoriaPlugin;
  /** import 対象の plugin.ts / plugin.js 絶対パス (ホットリロードで再 import する)。 */
  entryFile: string;
  /** プラグインフォルダ。 */
  dir: string;
}

export interface LoaderLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const defaultLog: LoaderLog = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

function msg(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

function isPlugin(x: unknown): x is MemoriaPlugin {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<MemoriaPlugin>;
  return typeof p.id === 'string' && typeof p.name === 'string' && typeof p.icon === 'string';
}

/** plugin フォルダ内の entry (plugin.ts 優先) を返す。 無ければ null。 */
function findEntry(dir: string, name: string): string | null {
  return (
    ['plugin.ts', 'plugin.js']
      .map((f) => join(dir, name, f))
      .find((p) => existsSync(p)) ?? null
  );
}

/**
 * entry を await import して default export を取り出す。
 * cacheBust を渡すと URL に ?v= を付け、 ESM モジュールキャッシュを回避して再読込する
 * (ホットリロード用)。
 */
export async function importPluginModule(
  entryFile: string,
  cacheBust?: string,
): Promise<MemoriaPlugin> {
  const href = pathToFileURL(entryFile).href + (cacheBust ? `?v=${cacheBust}` : '');
  const mod = (await import(href)) as { default?: unknown };
  if (!isPlugin(mod.default)) {
    throw new Error(`default export が MemoriaPlugin ではありません: ${entryFile}`);
  }
  return mod.default;
}

/**
 * 1 つの plugins ディレクトリを走査して LoadedPlugin を集める。
 * - 存在しないディレクトリは info ログを出して [] (外部フォルダ未配置を許容)。
 * - dot / underscore 始まりのフォルダは除外 (Concordia scanner と同じフィルタ)。
 * - 個々の失敗は console.error で必ず出して skip し、 他を止めない
 *   (握りつぶさない / 全滅させない)。
 */
async function scanDir(dir: string, log: LoaderLog): Promise<LoadedPlugin[]> {
  if (!existsSync(dir)) {
    log.info(`[loader] plugins ディレクトリが無いので skip: ${dir}`);
    return [];
  }

  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort();
  } catch (e) {
    log.error(`[loader] plugins ディレクトリ読込失敗 ${dir}: ${msg(e)}`);
    return [];
  }

  const loaded: LoadedPlugin[] = [];
  for (const name of names) {
    const entry = findEntry(dir, name);
    if (!entry) {
      log.warn(`[loader] ${name}: plugin.ts / plugin.js が無いので skip (${dir})`);
      continue;
    }
    try {
      const plugin = await importPluginModule(entry);
      loaded.push({ plugin, entryFile: entry, dir: join(dir, name) });
      log.info(`[loader] loaded "${plugin.id}" from ${join(dir, name)}`);
    } catch (e) {
      log.error(`[loader] ${name}: 読込失敗 — skip (${dir})\n${msg(e)}`);
    }
  }
  return loaded;
}

/**
 * 複数の plugins ディレクトリを優先順 (先頭が低優先) に走査して読み込む。
 * 同じ id があれば後の (= より外部寄りの) フォルダが上書きする。
 * 呼び出し側は [同梱, ...外部] の順で渡すこと → 外部 (ユーザカスタム) が優先される。
 */
export async function loadPlugins(
  dirs: string[],
  log: LoaderLog = defaultLog,
): Promise<LoadedPlugin[]> {
  const byId = new Map<string, LoadedPlugin>();
  for (const dir of dirs) {
    const found = await scanDir(dir, log);
    for (const item of found) {
      const prev = byId.get(item.plugin.id);
      if (prev) {
        log.warn(`[loader] plugin id "${item.plugin.id}" を ${item.dir} が上書き (既存: ${prev.dir})`);
      }
      byId.set(item.plugin.id, item);
    }
  }
  return [...byId.values()];
}
