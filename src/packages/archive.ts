import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { writeFile, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { t, x } from 'tar';
import { packagePath, parseManifest, type PackageManifest, type ReleaseDescriptor } from './contract.js';
import { MAX_ARCHIVE_BYTES } from './acquisition.js';

const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 2000;

/** Only writes under a caller-owned, newly created staging directory. Never executes package code. */
export async function unpackVerified(
  bytes: Uint8Array, release: ReleaseDescriptor, staging: string,
): Promise<PackageManifest> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES || bytes.byteLength !== release.artifact.size ||
      createHash('sha256').update(bytes).digest('hex') !== release.artifact.sha256) {
    throw new Error('Package size or integrity mismatch');
  }
  const tarBytes = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES });
  const archive = join(staging, '.archive.tar');
  await writeFile(archive, tarBytes, { flag: 'wx', mode: 0o600 });
  try {
    const names = new Set<string>();
    const files = new Set<string>();
    const spellings = new Map<string, string>();
    let count = 0;
    let expanded = 0;
    let invalid: Error | undefined;
    await t({ file: archive, strict: true, maxMetaEntrySize: 4096, onReadEntry(entry) {
      try {
        if (++count > MAX_ENTRIES) throw new Error('Too many archive entries');
        if (entry.type !== 'File' && entry.type !== 'Directory') throw new Error('Only regular files and directories are allowed');
        const name = packagePath(entry.type === 'Directory' ? entry.path.replace(/\/$/, '') : entry.path);
        if (name !== 'package' && !name.startsWith('package/')) throw new Error('Archive must contain only package/');
        const key = name.toLowerCase();
        const segments = name.split('/');
        for (let i = 1; i <= segments.length; i++) {
          const spelling = segments.slice(0, i).join('/');
          const previous = spellings.get(spelling.toLowerCase());
          if (previous && previous !== spelling) throw new Error('Case-colliding archive path');
          spellings.set(spelling.toLowerCase(), spelling);
        }
        if (names.has(key)) throw new Error('Duplicate or case-colliding archive path');
        names.add(key);
        if (entry.type === 'File') files.add(key);
        expanded += entry.size;
        if (expanded > MAX_EXPANDED_BYTES) throw new Error('Archive expansion exceeds limit');
      } catch (error) {
        invalid ??= error instanceof Error ? error : new Error('Invalid archive');
      }
    } });
    if (invalid) throw invalid;
    for (const name of names) {
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (files.has(parts.slice(0, i).join('/'))) throw new Error('Archive file/directory collision');
      }
    }
    if (!files.has('package/plugin-package.json')) throw new Error('Missing package manifest');
    await x({ file: archive, cwd: staging, strict: true, preservePaths: false, noChmod: true, noMtime: true });
    const manifestPath = join(staging, 'package', 'plugin-package.json');
    if ((await stat(manifestPath)).size > 32_768) throw new Error('Manifest is too large');
    const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (JSON.stringify(manifest) !== JSON.stringify(release.manifest)) throw new Error('Catalog and package metadata differ');
    if (!files.has(`package/${manifest.entry}`.toLowerCase()) ||
        !(await stat(join(staging, 'package', manifest.entry))).isFile()) throw new Error('Missing package entry');
    // Package code is always ESM, independent of the embedding application's package.json.
    const packageJson = JSON.parse(await readFile(join(staging, 'package', 'package.json'), 'utf8')) as { type?: unknown };
    if (packageJson.type !== 'module') throw new Error('Package must declare type=module');
    return manifest;
  } finally {
    await unlink(archive);
  }
}
