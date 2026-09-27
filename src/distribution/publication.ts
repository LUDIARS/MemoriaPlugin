import { createHash } from 'node:crypto';
import { lstat, readFile, mkdir, writeFile, rename, unlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object, parseRelease, type ReleaseDescriptor } from '../packages/contract.js';
import { MAX_ARCHIVE_BYTES } from '../packages/acquisition.js';

export interface Publication {
  catalog: Buffer;
  releases: ReleaseDescriptor[];
  artifacts: Map<string, { path: string; size: number; digest: string }>;
}

export async function boundedFile(path: string, limit: number): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > limit) throw new Error('Invalid distribution file');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Distribution file exceeds size limit');
  return bytes;
}

/** Verify a complete publication before serving or promoting it. Never imports plugin code. */
export async function loadPublication(directory: string): Promise<Publication> {
  const catalog = await boundedFile(join(directory, 'catalog.json'), 1024 * 1024);
  const parsed = object(JSON.parse(catalog.toString('utf8')));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.releases) ||
      parsed.releases.length === 0 || parsed.releases.length > 1000) throw new Error('Invalid distribution catalog');
  const releases = parsed.releases.map(parseRelease);
  const artifacts: Publication['artifacts'] = new Map();
  const names = new Set<string>();
  for (const release of releases) {
    const filename = `${release.manifest.id}-${release.manifest.version}.tgz`;
    if (release.artifact.url !== `./${filename}` || names.has(filename.toLowerCase())) {
      throw new Error('Noncanonical or duplicate distribution artifact');
    }
    const path = join(directory, filename);
    const bytes = await boundedFile(path, MAX_ARCHIVE_BYTES);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== release.artifact.size || digest !== release.artifact.sha256) {
      throw new Error('Distribution artifact integrity mismatch');
    }
    names.add(filename.toLowerCase());
    artifacts.set(filename, { path, size: bytes.length, digest });
  }
  return { catalog, releases, artifacts };
}

/** A single build owns promotion. Existing versioned bytes are immutable and retained. */
export async function promotePublication(staged: string, destination: string): Promise<void> {
  const publication = await loadPublication(staged);
  await mkdir(destination, { recursive: true });
  let previous: Publication | undefined;
  // A missing first catalog is allowed, but a corrupt existing publication must not be replaced.
  try { previous = await loadPublication(destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const exists = await lstat(join(destination, 'catalog.json')).then(() => true, (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
      return false;
    });
    if (exists) throw error;
  }
  for (const release of publication.releases) {
    const name = `${release.manifest.id}-${release.manifest.version}.tgz`;
    const bytes = await boundedFile(join(staged, name), MAX_ARCHIVE_BYTES);
    const path = join(destination, name);
    const pending = join(destination, `.artifact-${randomUUID()}`);
    await writeFile(pending, bytes, { flag: 'wx' });
    try { await link(pending, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = await boundedFile(path, MAX_ARCHIVE_BYTES);
      if (!previous.equals(bytes)) throw new Error(`Published version is immutable: ${name}`);
    }
    finally { await unlink(pending); }
  }
  const releases = new Map<string, ReleaseDescriptor>();
  for (const release of [...(previous?.releases ?? []), ...publication.releases]) {
    const key = `${release.manifest.id}@${release.manifest.version}`.toLowerCase();
    const existing = releases.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(release)) throw new Error('Published release metadata is immutable');
    releases.set(key, release);
  }
  if (releases.size > 1000) throw new Error('Catalog exceeds release count limit');
  const catalog = JSON.stringify({ schemaVersion: 1, releases: [...releases.values()] }, null, 2) + '\n';
  if (Buffer.byteLength(catalog) > 1024 * 1024) throw new Error('Catalog exceeds client size limit');
  const temporary = join(destination, `.catalog-${randomUUID()}.json`);
  await writeFile(temporary, catalog, { flag: 'wx' });
  try { await rename(temporary, join(destination, 'catalog.json')); }
  catch (error) { await unlink(temporary); throw error; }
}
