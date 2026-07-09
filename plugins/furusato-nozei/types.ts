// furusato-nozei プラグインの共有型。 DB行 / API DTO をここに集約する。

export type MaritalStatus = 'single' | 'spouse_deduction';

export interface FurusatoSettingsRow {
  id: 1;
  annual_income_yen: number;
  marital_status: MaritalStatus;
  dependents_general: number;
  dependents_specific: number;
  social_insurance_rate: number;
  other_deductions_yen: number;
  updated_at: string;
}

export interface FurusatoGiftRow {
  id: number;
  year: number;
  municipality: string;
  product_name: string;
  category: string | null;
  amount_yen: number;
  donated_at: string | null;
  expected_ship_start: string | null;
  expected_ship_end: string | null;
  arrived_at: string | null;
  notified_at: string | null;
  reminded_at: string | null;
  source_url: string | null;
  image_url: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export type FurusatoBookmarkStatus = 'watching' | 'donated' | 'dismissed';

export interface FurusatoBookmarkRow {
  id: number;
  site: string | null;
  municipality: string | null;
  product_name: string;
  amount_yen: number | null;
  url: string;
  image_url: string | null;
  category: string | null;
  memo: string | null;
  status: FurusatoBookmarkStatus;
  created_at: string;
  converted_gift_id: number | null;
}

export interface FurusatoSuggestionRow {
  id: number;
  year: number;
  body_md: string;
  created_at: string;
}
