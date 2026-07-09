// furusato-nozei の自テーブルを冪等に用意する。 CREATE TABLE IF NOT EXISTS 必須。
// テーブル名は必ず db.table() 経由で得る (plugin-db.ts の prefix 検査に通すため)。

import type { PluginDb } from '../../host/plugin-db.js';

export function ensureSchema(db: PluginDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${db.table('settings')} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      annual_income_yen INTEGER NOT NULL DEFAULT 0,
      marital_status TEXT NOT NULL DEFAULT 'single',
      dependents_general INTEGER NOT NULL DEFAULT 0,
      dependents_specific INTEGER NOT NULL DEFAULT 0,
      social_insurance_rate REAL NOT NULL DEFAULT 0.15,
      other_deductions_yen INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${db.table('gifts')} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      municipality TEXT NOT NULL,
      product_name TEXT NOT NULL,
      category TEXT,
      amount_yen INTEGER NOT NULL,
      donated_at TEXT,
      expected_ship_start TEXT,
      expected_ship_end TEXT,
      arrived_at TEXT,
      notified_at TEXT,
      reminded_at TEXT,
      source_url TEXT,
      image_url TEXT,
      memo TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_furusato_gifts_year ON ${db.table('gifts')}(year);
    CREATE INDEX IF NOT EXISTS idx_furusato_gifts_arrival ON ${db.table('gifts')}(arrived_at, expected_ship_start);

    CREATE TABLE IF NOT EXISTS ${db.table('bookmarks')} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site TEXT,
      municipality TEXT,
      product_name TEXT NOT NULL,
      amount_yen INTEGER,
      url TEXT NOT NULL,
      image_url TEXT,
      category TEXT,
      memo TEXT,
      status TEXT NOT NULL DEFAULT 'watching',
      created_at TEXT NOT NULL,
      converted_gift_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_furusato_bookmarks_status ON ${db.table('bookmarks')}(status);

    CREATE TABLE IF NOT EXISTS ${db.table('suggestions')} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      body_md TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_furusato_suggestions_year ON ${db.table('suggestions')}(year);
  `);
}
