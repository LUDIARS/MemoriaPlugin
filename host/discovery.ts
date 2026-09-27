import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { packageId, packagePath, text, object } from '../src/packages/contract.js';
import type { InstalledPackage } from '../src/packages/storage.js';
import { importPluginModule, type LoaderLog, type LoadedPlugin } from './loader.js';
import type { MemoriaPlugin } from './types.js';

export interface PluginSource {
  metadata: Pick<MemoriaPlugin, 'id' | 'name' | 'icon' | 'description'>;
  entryFile: string;
  dir: string;
  /** Connections belong to activate/dispose, never module scope. */
  load(): Promise<MemoriaPlugin>;
}

export function installedSource(item: InstalledPackage): PluginSource {
  return { metadata: item.release.manifest, entryFile: item.entryFile, dir: item.directory,
    load: () => importPluginModule(item.entryFile) };
}

export function loadedSource(item: LoadedPlugin): PluginSource {
  let initial = true;
  let sequence = 0;
  return { metadata: item.plugin, entryFile: item.entryFile, dir: item.dir, async load() {
    if (initial) { initial = false; return item.plugin; }
    return importPluginModule(item.entryFile, String(++sequence));
  } };
}

/** Declarative folder metadata permits listing without importing executable entries. */
export async function discoverPlugins(dirs: string[], log: LoaderLog): Promise<PluginSource[]> {
  const sources = new Map<string, PluginSource>();
  for (const dir of dirs) {
    let children;
    try { children = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      log.info('Optional local plugin directory is not installed');
      continue;
    }
    const legacy: string[] = [];
    for (const child of children.filter((item) => item.isDirectory() && !/^[._]/.test(item.name))) {
      const folder = join(dir, child.name);
      let value: unknown;
      try { value = JSON.parse(await readFile(join(folder, 'plugin.json'), 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        legacy.push(child.name);
        continue;
      }
      const m = object(value);
      const metadata = { id: packageId(m.id), name: text(m.name, 'name'), icon: text(m.icon, 'icon', 32),
        description: typeof m.description === 'string' ? m.description : '' };
      const entryFile = join(folder, packagePath(m.entry));
      let sequence = 0;
      sources.set(metadata.id, { metadata, entryFile, dir: folder,
        load: () => importPluginModule(entryFile, String(++sequence)) });
    }
    if (legacy.length) {
      log.warn('Legacy plugins without plugin.json require eager discovery; connection activation remains lazy');
      for (const name of legacy) {
        const folder = join(dir, name);
        let entryFile = join(folder, 'plugin.ts');
        try { await access(entryFile); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          entryFile = join(folder, 'plugin.js');
        }
        const plugin = await importPluginModule(entryFile);
        sources.set(plugin.id, loadedSource({ plugin, entryFile, dir: folder }));
      }
    }
  }
  return [...sources.values()];
}
