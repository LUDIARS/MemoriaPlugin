// プラグインジョブ (ライフサイクル) の起動。 intervalMs ごとに run を呼ぶ。
// run 内の例外は握りつぶさずログに必ず出す ([[feedback_no_error_swallow]])。
// 各ジョブの停止関数 (disposer) を返す → ホットリロード時に確実に止められる。

import type { MemoriaPlugin, PluginContext } from './types.js';

function msg(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/**
 * plugin.jobs を起動し、 停止関数の配列を返す。
 * 起動直後に 1 回 + 以後 intervalMs ごと。 タイマーは unref して終了を妨げない。
 */
export function startJobs(plugin: MemoriaPlugin, ctx: PluginContext): Array<() => void> {
  const disposers: Array<() => void> = [];
  for (const job of plugin.jobs ?? []) {
    const tick = (): void => {
      job.run(ctx).catch((e: unknown) => {
        ctx.log(`job ${job.id} 失敗: ${msg(e)}`);
      });
    };
    const first = setTimeout(tick, 3000);
    first.unref?.();
    const repeat = setInterval(tick, job.intervalMs);
    repeat.unref?.();
    disposers.push(() => {
      clearTimeout(first);
      clearInterval(repeat);
    });
    ctx.log(`job ${job.id} started (every ${Math.round(job.intervalMs / 1000)}s)`);
  }
  return disposers;
}
