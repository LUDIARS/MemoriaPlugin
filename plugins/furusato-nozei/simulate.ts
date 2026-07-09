// ふるさと納税「控除上限額」の概算シミュレーション。
//
// 総務省の早見表と同じ考え方 (給与所得控除→所得控除→課税所得→所得税率→
// 住民税所得割額→限度額の逆算式) の概算計算。 医療費控除・住宅ローン控除・
// iDeCo 等の個別事情、 実際の社会保険料率は考慮しないため、 結果はあくまで目安。
// (この非自明な前提を利用者に伝えるため note を必ず返す。)

import type { MaritalStatus } from './types.js';

export interface FurusatoProfileInput {
  annualIncomeYen: number;
  maritalStatus: MaritalStatus;
  dependentsGeneral: number;
  dependentsSpecific: number;
  socialInsuranceRate: number;
  otherDeductionsYen: number;
}

export interface FurusatoLimitEstimate {
  limitYen: number;
  employmentIncomeYen: number;
  incomeTaxRatePercent: number;
  residentTaxIncomeLevyYen: number;
  note: string;
}

const EMPLOYMENT_INCOME_BRACKETS: Array<{ maxYen: number; calc: (income: number) => number }> = [
  { maxYen: 1_625_000, calc: () => 550_000 },
  { maxYen: 1_800_000, calc: (i) => Math.max(i * 0.4 - 100_000, 0) },
  { maxYen: 3_600_000, calc: (i) => i * 0.3 + 80_000 },
  { maxYen: 6_600_000, calc: (i) => i * 0.2 + 440_000 },
  { maxYen: 8_500_000, calc: (i) => i * 0.1 + 1_100_000 },
  { maxYen: Infinity, calc: () => 1_950_000 },
];

const INCOME_TAX_BRACKETS: Array<{ maxYen: number; rate: number }> = [
  { maxYen: 1_950_000, rate: 0.05 },
  { maxYen: 3_300_000, rate: 0.10 },
  { maxYen: 6_950_000, rate: 0.20 },
  { maxYen: 9_000_000, rate: 0.23 },
  { maxYen: 18_000_000, rate: 0.33 },
  { maxYen: 40_000_000, rate: 0.40 },
  { maxYen: Infinity, rate: 0.45 },
];

const BASIC_DEDUCTION_INCOME_TAX_YEN = 480_000;
const BASIC_DEDUCTION_RESIDENT_TAX_YEN = 430_000;
const SPOUSE_DEDUCTION_INCOME_TAX_YEN = 380_000;
const SPOUSE_DEDUCTION_RESIDENT_TAX_YEN = 330_000;
const DEPENDENT_GENERAL_INCOME_TAX_YEN = 380_000;
const DEPENDENT_GENERAL_RESIDENT_TAX_YEN = 330_000;
const DEPENDENT_SPECIFIC_INCOME_TAX_YEN = 630_000;
const DEPENDENT_SPECIFIC_RESIDENT_TAX_YEN = 450_000;

// 各ブラケット配列は末尾が maxYen: Infinity なので find は必ずヒットする (non-null 安全)。
function employmentIncomeDeductionYen(incomeYen: number): number {
  const bracket = EMPLOYMENT_INCOME_BRACKETS.find((b) => incomeYen <= b.maxYen)!;
  return Math.round(bracket.calc(incomeYen));
}

function incomeTaxRate(taxableIncomeYen: number): number {
  const bracket = INCOME_TAX_BRACKETS.find((b) => taxableIncomeYen <= b.maxYen)!;
  return bracket.rate;
}

function deductionTotalYen(
  input: FurusatoProfileInput,
  basicYen: number,
  spouseYen: number,
  generalYen: number,
  specificYen: number,
): number {
  let total = basicYen + input.otherDeductionsYen;
  if (input.maritalStatus === 'spouse_deduction') total += spouseYen;
  total += input.dependentsGeneral * generalYen;
  total += input.dependentsSpecific * specificYen;
  return total;
}

const ESTIMATE_NOTE =
  'この金額は概算です。医療費控除・住宅ローン控除・iDeCo等の個別事情や実際の社会保険料率により変動します。' +
  '正確な金額は自治体の早見表・税理士・確定申告書等でご確認ください。';

export function estimateFurusatoLimit(input: FurusatoProfileInput): FurusatoLimitEstimate {
  const employmentIncomeYen = Math.max(
    input.annualIncomeYen - employmentIncomeDeductionYen(input.annualIncomeYen),
    0,
  );
  const socialInsuranceDeductionYen = Math.round(input.annualIncomeYen * input.socialInsuranceRate);

  const taxableIncomeTaxYen = Math.max(
    employmentIncomeYen -
      socialInsuranceDeductionYen -
      deductionTotalYen(
        input,
        BASIC_DEDUCTION_INCOME_TAX_YEN,
        SPOUSE_DEDUCTION_INCOME_TAX_YEN,
        DEPENDENT_GENERAL_INCOME_TAX_YEN,
        DEPENDENT_SPECIFIC_INCOME_TAX_YEN,
      ),
    0,
  );
  const taxableIncomeResidentYen = Math.max(
    employmentIncomeYen -
      socialInsuranceDeductionYen -
      deductionTotalYen(
        input,
        BASIC_DEDUCTION_RESIDENT_TAX_YEN,
        SPOUSE_DEDUCTION_RESIDENT_TAX_YEN,
        DEPENDENT_GENERAL_RESIDENT_TAX_YEN,
        DEPENDENT_SPECIFIC_RESIDENT_TAX_YEN,
      ),
    0,
  );

  const incomeTaxRatePercent = incomeTaxRate(taxableIncomeTaxYen) * 100;
  const residentTaxIncomeLevyYen = Math.round(taxableIncomeResidentYen * 0.10);

  const denom = 0.9 - (incomeTaxRatePercent / 100) * 1.021;
  const limitYen = denom > 0 ? Math.floor((residentTaxIncomeLevyYen * 0.2) / denom + 2_000) : 0;

  return {
    limitYen: Math.max(limitYen, 0),
    employmentIncomeYen,
    incomeTaxRatePercent,
    residentTaxIncomeLevyYen,
    note: ESTIMATE_NOTE,
  };
}
