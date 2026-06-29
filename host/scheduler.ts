// プラグインジョブの起動。 intervalMs ごとに run を呼ぶだけ。
// run 内の例外は握りつぶさずログに必ず出す ([[feedback_no_error_swallow]])。

import type { MemoriaPlugin, PluginContext } from './types.js';

export function startJobs(plugin: MemoriaPlugin, ctx: PluginContext): void {
  for (const job of plugin.jobs ?? []) {
    const tick = () => {
      job.run(ctx).catch((e: unknown) => {
        ctx.log(`job ${job.id} 失敗: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      });
    };
    // 起動直後に 1 回 + 以後 intervalMs ごと。
    setTimeout(tick, 3000).unref?.();
    setInterval(tick, job.intervalMs).unref?.();
    ctx.log(`job ${job.id} started (every ${Math.round(job.intervalMs / 1000)}s)`);
  }
}
