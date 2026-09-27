import { Hono } from 'hono';
import type { PluginContext, PluginStatus } from './types.js';
import type { PluginSource } from './discovery.js';
import { detectRequirements, summarizeUnmet } from './requirements.js';
import { startJobs } from './scheduler.js';

export interface PluginInstance {
  app: Hono;
  status: PluginStatus;
  reason?: string;
  dispose(): Promise<void>;
}

/** Owns resources acquired by one activation, including partially failed activations. */
export async function createInstance(source: PluginSource, context: PluginContext): Promise<PluginInstance> {
  const controller = new AbortController();
  const disposers: Array<() => void | Promise<void>> = [];
  let disposed = false;
  const ctx: PluginContext = { ...context, signal: controller.signal,
    onDispose(dispose) {
      if (disposed) throw new Error('Plugin has already been disposed');
      disposers.push(dispose);
    } };
  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    controller.abort();
    const errors: unknown[] = [];
    for (const release of disposers.reverse()) {
      try { await release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Plugin cleanup failed');
  }
  try {
    const plugin = await source.load();
    if (plugin.id !== source.metadata.id) throw new Error('Plugin entry identity differs from manifest');
    const app = new Hono();
    plugin.routes?.(app, ctx);
    const requirements = await detectRequirements(plugin, ctx);
    if (!requirements.ok) return { app, status: 'needs-setup', reason: summarizeUnmet(requirements.unmet), dispose };
    await plugin.activate?.(ctx);
    disposers.push(...startJobs(plugin, ctx));
    return { app, status: 'ready', dispose };
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Activation and cleanup failed'); }
    throw error;
  }
}
