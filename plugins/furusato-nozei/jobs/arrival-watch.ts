// 発送時期の到着監視 job。 expected_ship_start を迎えて未到着 (arrived_at null) の
// ギフトを検出し、 ctx.memoria.announce で通知する。 初回通知 + 発送終了予定から
// 14 日経っても未着なら 1 回だけフォローアップ通知 (無限スパムはしない)。

import type { PluginContext } from '../../../host/types.js';
import { listAwaitingNotification, markNotified, markReminded } from '../gifts-repo.js';
import { todayLocal, nowIso, daysBetween } from '../date-util.js';

const FOLLOW_UP_AFTER_DAYS = 14;

export async function arrivalWatch(ctx: PluginContext): Promise<void> {
  const today = todayLocal();
  // expected_ship_end から FOLLOW_UP_AFTER_DAYS 日以上経過した行だけフォローアップ対象にするため、
  // 「今日から FOLLOW_UP_AFTER_DAYS 日引いた日付以前が expected_ship_end」の行を拾う。
  const followUpCutoff = shiftDate(today, -FOLLOW_UP_AFTER_DAYS);
  const targets = listAwaitingNotification(ctx.db, today, followUpCutoff);

  for (const gift of targets) {
    const now = nowIso();
    if (!gift.notified_at) {
      await ctx.memoria.announce(
        `🎁 ふるさと納税「${gift.municipality} ${gift.product_name}」が発送時期です。到着を確認してください。`,
      );
      markNotified(ctx.db, gift.id, now);
      ctx.log(`notified (initial): gift#${gift.id} ${gift.municipality}`);
      continue;
    }
    if (!gift.reminded_at && gift.expected_ship_end && daysBetween(gift.expected_ship_end, today) >= FOLLOW_UP_AFTER_DAYS) {
      await ctx.memoria.announce(
        `🎁 ふるさと納税「${gift.municipality} ${gift.product_name}」が発送予定期間を過ぎても未到着チェックのままです。到着していれば記録してください。`,
      );
      markReminded(ctx.db, gift.id, now);
      ctx.log(`notified (follow-up): gift#${gift.id} ${gift.municipality}`);
    }
  }
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
