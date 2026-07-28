// プラグイン専用 SQLite アクセサ。
//
// 方針 (ユーザ確定):
//  - データは SQLite で管理する。
//  - プラグインは "plugin_<id>_*" prefix のテーブルを自由なスキーマで作成・読み書きできる。
//  - 本体含む他テーブルは「参照のみ」 (read-only な SELECT)。
//  - これらをアクセサ (PluginDb) で強制する。
//
// 強制方法:
//  - exec / run / all / get … 自テーブル系。 SQL が触るテーブル名が全て prefix で
//    始まることを検査し、 prefix 外 (本体テーブル等) を触る文は throw して弾く。
//  - query … 任意テーブルへの読取り専用 SELECT。 better-sqlite3 Statement.readonly が
//    false (= 書込みを伴う) なら throw する。
// 例外は握りつぶさず必ず投げる ([[feedback_no_silent_fallback]] / [[feedback_no_error_swallow]])。

import type { SqliteLike } from './sqlite.js';

export interface PluginDb {
  /** 自プラグイン専用テーブルの prefix (例 "plugin_example_")。 */
  readonly prefix: string;
  /** 論理名から物理テーブル名 (prefix + 正規化名) を得る。 */
  table(name: string): string;
  /** 自テーブルへの DDL/DML (CREATE/ALTER/DROP/INSERT/UPDATE/DELETE 等)。 prefix 外を触ると throw。 */
  exec(sql: string): void;
  /** 自テーブルへの単発書込み/読取り。 prefix 外を触ると throw。 */
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  /** 自テーブルからの SELECT (複数行)。 */
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
  /** 自テーブルからの SELECT (単行)。 */
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  /** 本体含む任意テーブルへの読取り専用 SELECT。 書込み文は throw。 */
  query<T = unknown>(sql: string, ...params: unknown[]): T[];
}

// FROM / JOIN / INTO / UPDATE / TABLE の直後に来るテーブル識別子を拾う。
// CREATE/DROP/ALTER TABLE, INSERT INTO, UPDATE, DELETE FROM, SELECT ... FROM/JOIN を捕捉。
const TABLE_REF = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+["'`\[]?([A-Za-z_][A-Za-z0-9_]*)/gi;

// "CREATE TABLE IF NOT EXISTS x" / "DROP TABLE IF EXISTS x" / "CREATE TEMP TABLE x" 等の
// 修飾子は識別子検査の邪魔になるので先に除去し、 テーブル名が直後に来る形へ正規化する。
const QUALIFIERS = /\b(?:IF\s+NOT\s+EXISTS|IF\s+EXISTS|TEMPORARY|TEMP|OR\s+(?:REPLACE|IGNORE|ABORT|FAIL|ROLLBACK))\b/gi;

function slug(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function pluginTablePrefix(pluginId: string): string {
  const s = slug(pluginId);
  if (!s) throw new Error(`plugin id からテーブル prefix を生成できません: "${pluginId}"`);
  return `plugin_${s}_`;
}

export function createPluginDb(sqlite: SqliteLike, pluginId: string): PluginDb {
  const prefix = pluginTablePrefix(pluginId);

  /** SQL が触るテーブルが全て自 prefix 配下かを検査する。 違反は throw。 */
  function assertOwned(sql: string): void {
    const normalized = sql.replace(QUALIFIERS, ' ');
    const refs = [...normalized.matchAll(TABLE_REF)].map((m) => m[1] as string);
    // "ON CONFLICT(...) DO UPDATE SET col = ..." の UPSERT 構文では TABLE_REF が
    // UPDATE の直後の "SET" をテーブル名と誤認して捕捉する (実際のテーブル参照ではない)。
    // "SET" が正当なテーブル名になることは無い (prefix 規約上あり得ない) ため除外する。
    const foreign = refs.filter((t) => !t.toLowerCase().startsWith(prefix) && t.toUpperCase() !== 'SET');
    if (foreign.length > 0) {
      throw new Error(
        `[plugin-db] ${pluginId}: 自プラグイン外テーブル [${foreign.join(', ')}] への ` +
          `書込み/操作は不可。 自テーブルは "${prefix}*" で作成し、 他テーブルは ` +
          `query() で読取り専用参照すること。`,
      );
    }
  }

  return {
    prefix,
    table(name: string): string {
      const s = slug(name);
      if (!s) throw new Error(`[plugin-db] ${pluginId}: 不正なテーブル名 "${name}"`);
      return `${prefix}${s}`;
    },
    exec(sql: string): void {
      assertOwned(sql);
      sqlite.exec(sql);
    },
    run(sql: string, ...params: unknown[]) {
      assertOwned(sql);
      return sqlite.prepare(sql).run(...params);
    },
    all<T = unknown>(sql: string, ...params: unknown[]): T[] {
      assertOwned(sql);
      return sqlite.prepare(sql).all(...params) as T[];
    },
    get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
      assertOwned(sql);
      return sqlite.prepare(sql).get(...params) as T | undefined;
    },
    query<T = unknown>(sql: string, ...params: unknown[]): T[] {
      const stmt = sqlite.prepare(sql);
      if (!stmt.readonly) {
        throw new Error(
          `[plugin-db] ${pluginId}: query() は読取り専用 (SELECT) のみ。 ` +
            `書込みは自テーブルへ run()/exec() を使うこと。`,
        );
      }
      return stmt.all(...params) as T[];
    },
  };
}
