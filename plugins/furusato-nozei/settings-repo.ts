// furusato_nozei_settings の read/write (単一行、 id=1)。

import type { PluginDb } from '../../host/plugin-db.js';
import type { FurusatoSettingsRow, MaritalStatus } from './types.js';
import { nowIso } from './date-util.js';

const DEFAULT_SETTINGS: Omit<FurusatoSettingsRow, 'updated_at'> = {
  id: 1,
  annual_income_yen: 0,
  marital_status: 'single',
  dependents_general: 0,
  dependents_specific: 0,
  social_insurance_rate: 0.15,
  other_deductions_yen: 0,
};

export function getSettings(db: PluginDb): FurusatoSettingsRow {
  const row = db.get<FurusatoSettingsRow>(`SELECT * FROM ${db.table('settings')} WHERE id = 1`);
  if (row) return row;
  const settings: FurusatoSettingsRow = { ...DEFAULT_SETTINGS, updated_at: nowIso() };
  saveSettings(db, settings);
  return settings;
}

export interface SettingsPatch {
  annual_income_yen?: number;
  marital_status?: MaritalStatus;
  dependents_general?: number;
  dependents_specific?: number;
  social_insurance_rate?: number;
  other_deductions_yen?: number;
}

export function saveSettings(db: PluginDb, patch: SettingsPatch): FurusatoSettingsRow {
  const cur = db.get<FurusatoSettingsRow>(`SELECT * FROM ${db.table('settings')} WHERE id = 1`) ?? {
    ...DEFAULT_SETTINGS,
    updated_at: nowIso(),
  };
  const next: FurusatoSettingsRow = { ...cur, ...patch, id: 1, updated_at: nowIso() };
  // 単一行 (id=1) の全列を書き直すだけなので INSERT OR REPLACE で足りる。
  db.run(
    `INSERT OR REPLACE INTO ${db.table('settings')}
       (id, annual_income_yen, marital_status, dependents_general, dependents_specific, social_insurance_rate, other_deductions_yen, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    next.annual_income_yen,
    next.marital_status,
    next.dependents_general,
    next.dependents_specific,
    next.social_insurance_rate,
    next.other_deductions_yen,
    next.updated_at,
  );
  return next;
}
