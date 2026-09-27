import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { c } from 'tar';
import { PackageStore } from '../src/packages/storage.js';
import { packagePath, parseManifest, type ReleaseDescriptor } from '../src/packages/contract.js';
import { readCatalog, downloadPackage } from '../src/packages/acquisition.js';

async function fixture(root: string, version = '1.0.0', host = 'example-host'): Promise<{ bytes: Buffer; release: ReleaseDescriptor }> {
  const dir = join(root, `input-${version}`);
  await mkdir(join(dir, 'package'), { recursive: true });
  const manifest = parseManifest({ schemaVersion: 1, id: 'example', version, name: 'Example', icon: 'E',
    description: '', runtime: 'node-esm', hostApi: { id: host, range: '^1.0.0' }, entry: 'plugin.js', capabilities: [] });
  await writeFile(join(dir, 'package', 'plugin-package.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'package', 'package.json'), '{"type":"module"}');
  await writeFile(join(dir, 'package', 'plugin.js'), 'throw new Error("installation must not execute code");');
  const file = join(dir, 'package.tgz');
  await c({ cwd: dir, file, gzip: true, portable: true }, ['package']);
  const bytes = await readFile(file);
  return { bytes, release: { manifest, artifact: { url: './example.tgz', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } } };
}

test('a second host installs, restarts and resolves packages without a distribution connection or imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mmp-offline-'));
  try {
    const { bytes, release } = await fixture(root);
    const store = new PackageStore(join(root, 'store'), { id: 'example-host', version: '1.0.0' });
    await store.install(bytes, release);
    await store.select('example', '1.0.0');
    const restarted = new PackageStore(join(root, 'store'), { id: 'example-host', version: '1.0.0' });
    assert.equal((await restarted.active())[0]?.release.manifest.version, '1.0.0');
    const bad = await fixture(root, '2.0.0');
    bad.bytes[0] = 0;
    await assert.rejects(store.install(bad.bytes, bad.release), /integrity/);
    assert.equal((await restarted.active())[0]?.release.manifest.version, '1.0.0');
    await store.unselect('example');
    assert.equal((await store.active()).length, 0);
    assert.equal((await store.version('example', '1.0.0')).release.manifest.id, 'example');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unsafe archive path names are rejected independently of host OS', () => {
  for (const value of ['../x', '/x', 'a\\b', 'a/../b', 'a:x', 'CON.txt', 'a/NUL', 'a.', 'a ', 'a\0x', 'a//b']) {
    assert.throws(() => packagePath(value));
  }
});

test('host compatibility is validated before staging a package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mmp-compat-'));
  try {
    const { bytes, release } = await fixture(root);
    const store = new PackageStore(join(root, 'store'), { id: 'different-host', version: '1.0.0' });
    await assert.rejects(store.install(bytes, release), /compatible/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('artifact credentials cannot leave the configured catalog origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mmp-origin-'));
  try {
    const { release } = await fixture(root);
    release.artifact.url = 'https://untrusted.invalid/code.tgz';
    let requests = 0;
    const source = { url: 'https://catalog.invalid/catalog.json', fetch: async () => {
      requests++; return new Response(JSON.stringify({ schemaVersion: 1, releases: [release] }));
    } };
    const listed = await readCatalog(source);
    await assert.rejects(downloadPackage(source, listed[0]!), /origin/);
    assert.equal(requests, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('oversized catalog response is rejected while streaming', async () => {
  let cancelled = false;
  const source = { url: 'https://catalog.invalid/catalog.json', fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelled = true; },
  })) };
  await assert.rejects(readCatalog(source), /size limit/);
  assert.equal(cancelled, true);
});
