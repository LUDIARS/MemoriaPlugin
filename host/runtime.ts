import { Hono, type Context } from 'hono';
import type { PluginContext, PluginManifestEntry } from './types.js';
import type { SqliteLike } from './sqlite.js';
import { createCapabilities, type CapabilityProviders } from './capabilities.js';
import { createSettingsStore } from './settings-store.js';
import { createPluginDb } from './plugin-db.js';
import type { LoadedPlugin } from './loader.js';
import { loadedSource, type PluginSource } from './discovery.js';
import { createInstance, type PluginInstance } from './instance.js';
import { SerialOperation } from '../src/lifecycle/serial.js';

interface RuntimeEntry { source: PluginSource; instance?: PluginInstance; error?: string }
export interface RegistryConfig {
  dataDir: string;
  sqlite: SqliteLike;
  capabilities: CapabilityProviders;
  log?: (message: string) => void;
}
export interface PluginRegistry {
  manifest(): PluginManifestEntry[];
  reload(id: string): Promise<PluginManifestEntry | null>;
  activate(id: string): Promise<PluginManifestEntry | null>;
  replace(source: PluginSource, persist?: () => Promise<void>): Promise<PluginManifestEntry>;
  remove(id: string, persist?: () => Promise<void>): Promise<void>;
  dispose(): Promise<void>;
  ids(): string[];
}

/** Registry creation does not require a catalog, executable imports or background jobs. */
export async function buildRegistry(app: Hono, sources: Array<LoadedPlugin | PluginSource>, cfg: RegistryConfig): Promise<PluginRegistry> {
  const entries = new Map<string, RuntimeEntry>();
  const queues = new Map<string, SerialOperation>();
  let stopped = false;
  function queue(id: string): SerialOperation {
    let value = queues.get(id);
    if (!value) { value = new SerialOperation(); queues.set(id, value); }
    return value;
  }
  function log(message: string): void { cfg.log?.(message); }
  function context(id: string): PluginContext {
    return { settings: createSettingsStore(cfg.dataDir, id), db: createPluginDb(cfg.sqlite, id),
      memoria: createCapabilities(id, cfg.capabilities), log: (message) => log(`[${id}] ${message}`), basePath: `/plugins/${id}` };
  }
  function manifest(entry: RuntimeEntry): PluginManifestEntry {
    const m = entry.source.metadata;
    return { id: m.id, name: m.name, icon: m.icon, description: m.description ?? '', url: `/plugins/${m.id}`,
      status: entry.error ? 'error' : entry.instance?.status ?? 'inactive', statusReason: entry.error ?? entry.instance?.reason };
  }
  async function ensureActive(entry: RuntimeEntry): Promise<PluginInstance> {
    if (stopped) throw new Error('Plugin registry is stopped');
    if (!entry.instance) {
      try { entry.instance = await createInstance(entry.source, context(entry.source.metadata.id)); entry.error = undefined; }
      catch (error) { entry.error = 'Plugin activation failed'; log(entry.error); throw error; }
    }
    return entry.instance;
  }
  async function replaceEntry(source: PluginSource, persist?: () => Promise<void>): Promise<PluginManifestEntry> {
      if (stopped) throw new Error('Plugin registry is stopped');
      const old = entries.get(source.metadata.id);
      // Validate the module before retiring the previous instance. Module scope must be side-effect free.
      const plugin = await source.load();
      if (plugin.id !== source.metadata.id) throw new Error('Plugin identity mismatch');
      const next: RuntimeEntry = { source };
      if (old?.instance) {
        await old.instance.dispose();
        old.instance = undefined;
        try { next.instance = await createInstance({ ...source, load: async () => plugin }, context(plugin.id)); }
        catch (error) {
          log('Replacement failed; reactivating previous plugin');
          await ensureActive(old);
          throw error;
        }
      }
      try { await persist?.(); }
      catch (error) {
        await next.instance?.dispose();
        if (old && !old.instance) await ensureActive(old);
        throw error;
      }
      entries.set(source.metadata.id, next);
      return manifest(next);
  }
  async function replace(source: PluginSource, persist?: () => Promise<void>): Promise<PluginManifestEntry> {
    return queue(source.metadata.id).run(() => replaceEntry(source, persist));
  }
  async function dispatch(c: Context): Promise<Response> {
    const id = c.req.param('id');
    if (!id || !entries.has(id)) return c.notFound();
    return queue(id).run(async () => {
      const entry = entries.get(id);
      if (!entry) return c.notFound();
      const instance = await ensureActive(entry);
      const url = new URL(c.req.url);
      url.pathname = url.pathname.slice(`/plugins/${id}`.length) || '/';
      return instance.app.fetch(new Request(url, c.req.raw));
    });
  }
  for (const value of sources) {
    const source = 'metadata' in value ? value : loadedSource(value);
    entries.set(source.metadata.id, { source });
  }
  app.all('/plugins/:id', dispatch);
  app.all('/plugins/:id/*', dispatch);
  return {
    manifest: () => [...entries.values()].map(manifest), ids: () => [...entries.keys()], replace,
    async activate(id) {
      return queue(id).run(async () => {
        const entry = entries.get(id);
        if (!entry) return null;
        await ensureActive(entry);
        return manifest(entry);
      });
    },
    async reload(id) {
      return queue(id).run(async () => {
        const entry = entries.get(id);
        return entry ? replaceEntry(entry.source) : null;
      });
    },
    async remove(id, persist) {
      await queue(id).run(async () => {
        const old = entries.get(id);
        await old?.instance?.dispose();
        if (old) old.instance = undefined;
        await persist?.();
        entries.delete(id);
      });
    },
    async dispose() {
      stopped = true;
      const results = await Promise.allSettled([...entries.keys()].map((id) => queue(id).run(async () => {
        await entries.get(id)?.instance?.dispose();
        entries.delete(id);
      })));
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Plugin shutdown failed');
    },
  };
}
