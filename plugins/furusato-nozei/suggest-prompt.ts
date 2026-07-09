// AIサジェスト用プロンプトの組み立て (純粋関数)。 過去の返礼品・ウォッチ中の
// ブックマーク・残り枠から、 ボタン起点で LLM に「おすすめ」 を書かせる。

import type { FurusatoGiftRow, FurusatoBookmarkRow } from './types.js';
import type { FurusatoLimitEstimate } from './simulate.js';

export interface SuggestContext {
  year: number;
  limit: FurusatoLimitEstimate;
  totalDonatedYen: number;
  pastGifts: FurusatoGiftRow[];
  watchingBookmarks: FurusatoBookmarkRow[];
}

function yen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`;
}

export function buildSuggestPrompt(ctx: SuggestContext): string {
  const remainingYen = Math.max(ctx.limit.limitYen - ctx.totalDonatedYen, 0);

  const pastBlock = ctx.pastGifts.length
    ? ctx.pastGifts
        .slice(0, 40)
        .map((g) => `- ${g.municipality} 「${g.product_name}」 (${g.category ?? '分類なし'}) ${yen(g.amount_yen)}`)
        .join('\n')
    : '(この年の返礼品履歴なし)';

  const watchingBlock = ctx.watchingBookmarks.length
    ? ctx.watchingBookmarks
        .slice(0, 40)
        .map((b) => `- ${b.municipality ?? '自治体不明'} 「${b.product_name}」 (${b.category ?? '分類なし'})${b.amount_yen ? ` 寄付額目安 ${yen(b.amount_yen)}` : ''}`)
        .join('\n')
    : '(ウォッチ中のブックマークなし)';

  return [
    'あなたはふるさと納税の返礼品選びをサポートするアドバイザーだ。',
    '以下のデータをもとに、 今年まだ寄付していない残り枠を有効活用するための返礼品を具体的に提案せよ。',
    '過去の返礼品と偏らないジャンルを優先し、 ウォッチ中の候補があればそこから優先的に触れる。',
    '実行可能で具体的な提案を Markdown の箇条書きで書け (前後の説明・コードフェンス不要)。',
    '',
    `## 対象年: ${ctx.year}`,
    `## 控除上限額 (概算): ${yen(ctx.limit.limitYen)}`,
    `## 今年の寄付済み合計: ${yen(ctx.totalDonatedYen)}`,
    `## 残り枠 (概算): ${yen(remainingYen)}`,
    '',
    '## 今年の返礼品履歴',
    pastBlock,
    '',
    '## ウォッチ中 (気になる) ブックマーク',
    watchingBlock,
    '',
    '## 出力',
    '- 提案する返礼品カテゴリ/自治体の傾向 (2〜4件)',
    '- ウォッチ中ブックマークのうち優先度が高いもの (あれば)',
    '- 残り枠の使い切り方についての一言',
  ].join('\n');
}
