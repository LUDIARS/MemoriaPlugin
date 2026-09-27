import { lstat, readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseRelease, type ReleaseDescriptor } from '../packages/contract.js';
import { unpackVerified } from '../packages/archive.js';
import { MAX_ARCHIVE_BYTES } from '../packages/acquisition.js';

async function regularFile(path: string, limit: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error('Publication input must be a bounded regular file');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Publication input exceeds limit');
  return bytes;
}

/** Produces only public artifacts. No upload, network request or package execution. */
export async function assembleCatalog(output: string, descriptors: string[]): Promise<void> {
  if (!descriptors.length || descriptors.length > 1000) throw new Error('Expected 1 to 1000 release descriptors');
  // A new destination is required: failed builds must never damage a previously published catalog.
  await mkdir(output);
  try {
    const releases: ReleaseDescriptor[] = [];
    const filenames = new Set<string>();
    for (const descriptor of descriptors) {
      const release = parseRelease(JSON.parse((await regularFile(descriptor, 32_768)).toString('utf8')));
      const filename = `${release.manifest.id}-${release.manifest.version}.tgz`;
      if (release.artifact.url !== `./${filename}`) throw new Error('Publication requires the local canonical artifact filename');
      if (filenames.has(filename.toLowerCase())) throw new Error('Duplicate or case-colliding release');
      filenames.add(filename.toLowerCase());
      const bytes = await regularFile(join(dirname(descriptor), filename), MAX_ARCHIVE_BYTES);
      const staging = await mkdtemp(join(tmpdir(), 'mmp-publication-'));
      try {
        await unpackVerified(bytes, release, staging);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      await writeFile(join(output, filename), bytes, { flag: 'wx' });
      releases.push(release);
    }
    releases.sort((a, b) => {
      const left = `${a.manifest.id}@${a.manifest.version}`;
      const right = `${b.manifest.id}@${b.manifest.version}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const catalog = JSON.stringify({ schemaVersion: 1, releases }, null, 2) + '\n';
    if (Buffer.byteLength(catalog) > 1024 * 1024) throw new Error('Catalog exceeds client size limit');
    await writeFile(join(output, 'catalog.json'), catalog, { flag: 'wx' });
  } catch (error) {
    // mkdir above succeeded exclusively; only this invocation owns this output directory.
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
