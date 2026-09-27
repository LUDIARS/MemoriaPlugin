import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { c } from 'tar';
import { assembleCatalog } from '../src/distribution/catalog.js';
import { parseManifest } from '../src/packages/contract.js';
import { readCatalog, downloadPackage } from '../src/packages/acquisition.js';

async function fixture(root: string) {
  const input = join(root, 'input');
  await mkdir(join(input, 'package'), { recursive: true });
  const manifest = parseManifest({ schemaVersion: 1, id: 'example', version: '1.0.0', name: 'Example',
    description: '', icon: 'E', runtime: 'node-esm', hostApi: { id: 'another-host', range: '^1.0.0' },
    entry: 'plugin.js', capabilities: [] });
  await writeFile(join(input, 'package', 'plugin-package.json'), JSON.stringify(manifest));
  await writeFile(join(input, 'package', 'package.json'), '{"type":"module"}');
  await writeFile(join(input, 'package', 'plugin.js'), 'throw new Error("publication must not execute plugins");');
  const filename = 'example-1.0.0.tgz';
  await c({ cwd: input, file: join(input, filename), gzip: true, portable: true }, ['package']);
  const bytes = await readFile(join(input, filename));
  const release = { manifest, artifact: { url: `./${filename}`, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } };
  const descriptor = join(input, 'release.json');
  await writeFile(descriptor, JSON.stringify(release));
  await writeFile(join(input, '.env'), 'PRIVATE=not-for-publication');
  return { input, filename, descriptor, release, bytes };
}

test('public bundle is anonymously consumable by another host and excludes unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mmp-catalog-'));
  try {
    const { filename, descriptor, bytes } = await fixture(root);
    const output = join(root, 'public');
    await assembleCatalog(output, [descriptor]);
    assert.deepEqual((await readdir(output)).sort(), ['catalog.json', filename]);
    const source = { url: 'https://public.invalid/catalog.json', fetch: (async (url, init) => {
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      const path = new URL(String(url)).pathname.slice(1);
      assert.ok(path === 'catalog.json' || path === filename);
      return new Response(new Uint8Array(await readFile(join(output, path))));
    }) as typeof fetch };
    const [release] = await readCatalog(source);
    assert.equal(release!.manifest.hostApi.id, 'another-host');
    assert.deepEqual(Buffer.from(await downloadPackage(source, release!)), bytes);
    await assert.rejects(assembleCatalog(output, [descriptor]), /EEXIST/);
    assert.deepEqual(await readFile(join(output, filename)), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt and duplicate releases leave no partial public bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mmp-catalog-reject-'));
  try {
    const { input, filename, descriptor } = await fixture(root);
    const output = join(root, 'public');
    await assert.rejects(assembleCatalog(output, [descriptor, descriptor]), /Duplicate/);
    await assert.rejects(readdir(output), /ENOENT/);
    await writeFile(join(input, filename), 'corrupted');
    await assert.rejects(assembleCatalog(output, [descriptor]), /integrity/);
    await assert.rejects(readdir(output), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('publication rejects remote and traversal artifact references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mmp-catalog-path-'));
  try {
    const { descriptor, release } = await fixture(root);
    for (const url of ['../example-1.0.0.tgz', 'https://remote.invalid/example-1.0.0.tgz']) {
      release.artifact.url = url;
      await writeFile(descriptor, JSON.stringify(release));
      await assert.rejects(assembleCatalog(join(root, 'public'), [descriptor]), /canonical/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
