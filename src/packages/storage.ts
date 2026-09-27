import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { packageId, packageVersion, parseRelease, assertCompatible, type ReleaseDescriptor } from './contract.js';
import { unpackVerified } from './archive.js';

export interface InstalledPackage {
  release: ReleaseDescriptor;
  directory: string;
  entryFile: string;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** All mutable metadata belongs to one local store, never to the distribution server. */
export class PackageStore {
  readonly root: string;
  constructor(root: string, private readonly host: { id: string; version: string }) {
    this.root = resolve(root);
  }

  private versionDir(id: string, version: string): string {
    return join(this.root, packageId(id), 'versions', packageVersion(version));
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    // Exclusive filesystem lock also covers competing processes. Stale locks fail explicitly.
    const path = join(this.root, '.write-lock');
    const lock = await open(path, 'wx', 0o600);
    try { return await action(); }
    finally { await lock.close(); await rm(path); }
  }

  private async atomicJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }

  async version(id: string, version: string): Promise<InstalledPackage> {
    const location = this.versionDir(id, version);
    const release = parseRelease(JSON.parse(await readFile(join(location, 'release.json'), 'utf8')));
    if (release.manifest.id !== id || release.manifest.version !== version) throw new Error('Installed package identity mismatch');
    assertCompatible(release.manifest, this.host);
    const directory = join(location, 'package');
    return { release, directory, entryFile: join(directory, release.manifest.entry) };
  }

  /** Stage a verified version. Does not change the running plugin or active-version reference. */
  async install(bytes: Uint8Array, descriptor: ReleaseDescriptor): Promise<InstalledPackage> {
    const release = parseRelease(descriptor);
    assertCompatible(release.manifest, this.host);
    return this.locked(async () => {
      const staging = await mkdtemp(join(this.root, '.staging-'));
      try {
        await unpackVerified(bytes, release, staging);
        const { id, version } = release.manifest;
        const target = this.versionDir(id, version);
        try {
          const existing = await this.version(id, version);
          if (existing.release.artifact.sha256 !== release.artifact.sha256) throw new Error('Immutable version already exists with another digest');
          return existing;
        } catch (error) { if (!isMissing(error)) throw error; }
        await writeFile(join(staging, 'release.json'), JSON.stringify(release), { flag: 'wx', mode: 0o600 });
        await mkdir(join(this.root, id, 'versions'), { recursive: true });
        await rename(staging, target);
        return this.version(id, version);
      } finally {
        // Only remove the exact staging directory created by this invocation.
        const child = relative(this.root, staging);
        if (isAbsolute(child) || child.startsWith('..') || !child.startsWith('.staging-')) throw new Error('Unsafe staging cleanup');
        await rm(staging, { recursive: true, force: true });
      }
    });
  }

  async select(id: string, version: string): Promise<void> {
    await this.locked(async () => {
      await this.version(id, version);
      await this.atomicJson(join(this.root, packageId(id), 'active.json'), { version: packageVersion(version) });
    });
  }

  /** Deactivate code only. Settings and plugin data are owned by the host, never deleted here. */
  async unselect(id: string): Promise<void> {
    await this.locked(() => rm(join(this.root, packageId(id), 'active.json'), { force: true }));
  }

  async active(): Promise<InstalledPackage[]> {
    let names: string[];
    try { names = (await readdir(this.root, { withFileTypes: true })).filter((item) => item.isDirectory() && !item.name.startsWith('.')).map((item) => item.name); }
    catch (error) { if (isMissing(error)) return []; throw error; }
    const packages: InstalledPackage[] = [];
    for (const id of names.sort()) {
      let pointer: { version?: unknown };
      try { pointer = JSON.parse(await readFile(join(this.root, packageId(id), 'active.json'), 'utf8')) as { version?: unknown }; }
      catch (error) { if (isMissing(error)) continue; throw error; }
      packages.push(await this.version(id, packageVersion(pointer.version)));
    }
    return packages;
  }
}
