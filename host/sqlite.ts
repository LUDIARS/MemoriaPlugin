// プラグイン DB アクセサが要求する SQLite の最小構造型。
// 公開 submodule を better-sqlite3 へ硬く依存させないため、 host (Memoria 本体) から
// 渡される db ハンドルを「使う分だけ」の構造型で受ける。 better-sqlite3 の
// Database / Statement はこの形を構造的に満たす (prepare / exec / Statement.readonly)。

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  /** その文が DB を変更しないか (better-sqlite3 Statement.readonly)。 query() の読取り専用判定に使う。 */
  readonly readonly: boolean;
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteLike {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}
