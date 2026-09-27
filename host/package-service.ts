import { readCatalog, downloadPackage, type CatalogSource } from '../src/packages/acquisition.js';
import { PackageStore, type InstalledPackage } from '../src/packages/storage.js';
import type { ReleaseDescriptor } from '../src/packages/contract.js';
import { SerialOperation } from '../src/lifecycle/serial.js';
import type { PluginRegistry } from './runtime.js';
import { installedSource } from './discovery.js';

/** Memoria adapter: package transport/storage itself has no knowledge of this registry. */
export class PluginPackages {
  private readonly operations = new SerialOperation();
  constructor(
    readonly store: PackageStore,
    private readonly registry: PluginRegistry,
    private readonly source?: CatalogSource,
    private readonly protectedIds: ReadonlySet<string> = new Set(),
  ) {}

  catalog(): Promise<ReleaseDescriptor[]> {
    if (!this.source) throw new Error('No package catalog configured');
    return readCatalog(this.source);
  }

  private async enable(item: InstalledPackage): Promise<void> {
    if (this.protectedIds.has(item.release.manifest.id)) throw new Error('A local development override owns this plugin');
    await this.registry.replace(installedSource(item), () => this.store.select(item.release.manifest.id, item.release.manifest.version));
  }

  /** A digest from the selected release confirms the exact executable package the user approved. */
  install(id: string, version: string, approvedDigest: string): Promise<void> {
    return this.operations.run(async () => {
      if (!this.source) throw new Error('No package catalog configured');
      const release = (await this.catalog()).find((item) => item.manifest.id === id && item.manifest.version === version);
      if (!release || release.artifact.sha256 !== approvedDigest) throw new Error('Selected release has changed or is unavailable');
      const bytes = await downloadPackage(this.source, release);
      await this.enable(await this.store.install(bytes, release));
    });
  }

  installLocal(bytes: Uint8Array, release: ReleaseDescriptor): Promise<void> {
    return this.operations.run(async () => this.enable(await this.store.install(bytes, release)));
  }

  useVersion(id: string, version: string): Promise<void> {
    return this.operations.run(async () => this.enable(await this.store.version(id, version)));
  }

  uninstall(id: string): Promise<void> {
    return this.operations.run(async () => {
      if (this.protectedIds.has(id)) throw new Error('A local development override owns this plugin');
      const active = (await this.store.active()).some((item) => item.release.manifest.id === id);
      if (!active) throw new Error('Package is not installed');
      await this.registry.remove(id, () => this.store.unselect(id));
    });
  }
}
