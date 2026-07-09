// ローカル日付ユーティリティ。 private-transit と同じ流儀 (プラグインは各自 inline で持つ)。

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function currentYear(): number {
  return new Date().getFullYear();
}

/** a が b より日付として後 (同日含む) か。 YYYY-MM-DD の文字列比較で足りる。 */
export function dateAtOrAfter(a: string, b: string): boolean {
  return a >= b;
}

export function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00`).getTime();
  const to = new Date(`${toDate}T00:00:00`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}
