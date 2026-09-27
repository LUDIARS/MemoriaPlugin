import type { MemoriaPlugin, PluginContext } from './types.js';

/** Each timer owns at most one execution; disposal waits for that execution to settle. */
export function startJobs(plugin: MemoriaPlugin, ctx: PluginContext): Array<() => Promise<void>> {
  for (const job of plugin.jobs ?? []) {
    if (!Number.isSafeInteger(job.intervalMs) || job.intervalMs < 1 || job.intervalMs > 2_147_483_647) throw new Error('Invalid job interval');
  }
  return (plugin.jobs ?? []).map((job) => {
    let stopped = false;
    let running: Promise<void> | undefined;
    function tick(): void {
      if (stopped || running || ctx.signal?.aborted) return;
      running = Promise.resolve().then(() => job.run(ctx)).catch(() => {
        ctx.log(`job ${job.id} failed`);
      }).finally(() => { running = undefined; });
    }
    const first = setTimeout(tick, 3000);
    const repeat = setInterval(tick, job.intervalMs);
    first.unref?.(); repeat.unref?.();
    return async () => { stopped = true; clearTimeout(first); clearInterval(repeat); await running; };
  });
}
