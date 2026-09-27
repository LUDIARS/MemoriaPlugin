import { readFile, writeFile, mkdir, mkdtemp, cp, rm, lstat, readdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { c } from 'tar';
import { object, packagePath, parseManifest } from '../src/packages/contract.js';

const [sourceArg, version, outputArg] = process.argv.slice(2);
if (!sourceArg || !version || !outputArg) throw new Error('Usage: npm run package -- <plugin-folder> <version> <output-folder>');
const source = resolve(sourceArg);
const output = resolve(outputArg);
const config = object(JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8')));
const entry = packagePath(config.entry);
const manifest = parseManifest({ ...config, schemaVersion: 1, version, runtime: 'node-esm',
  hostApi: config.hostApi, entry: 'plugin.js', capabilities: config.capabilities });
if (!Array.isArray(config.assets)) throw new Error('Build metadata must explicitly list assets');

async function assertRegularTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Package assets must be regular files/directories');
  if (info.isDirectory()) for (const child of await readdir(path)) await assertRegularTree(join(path, child));
}

await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, '.pack-'));
try {
  const folder = join(staging, 'package');
  await mkdir(folder);
  await build({ entryPoints: [join(source, entry)], outfile: join(folder, 'plugin.js'), bundle: true,
    platform: 'node', target: 'node22', format: 'esm', sourcemap: false, logLevel: 'silent' });
  for (const asset of config.assets) {
    const name = packagePath(asset);
    if (['plugin.js', 'plugin-package.json', 'package.json'].includes(name.split('/')[0] ?? '')) throw new Error('Asset collides with package metadata');
    await assertRegularTree(join(source, name));
    await cp(join(source, name), join(folder, name), { recursive: true, errorOnExist: true, force: false });
  }
  await writeFile(join(folder, 'plugin-package.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(folder, 'package.json'), JSON.stringify({ type: 'module', name: manifest.id, version }));
  const filename = `${manifest.id}-${manifest.version}.tgz`;
  const temporary = join(staging, filename);
  await c({ cwd: staging, file: temporary, gzip: true, portable: true, noMtime: true }, ['package']);
  const bytes = await readFile(temporary);
  const release = { manifest, artifact: { url: `./${filename}`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
  await writeFile(join(output, filename), bytes, { flag: 'wx' });
  await writeFile(join(output, `${manifest.id}-${manifest.version}.json`), JSON.stringify(release, null, 2), { flag: 'wx' });
} finally {
  const child = relative(output, staging);
  if (isAbsolute(child) || child.startsWith('..') || !child.startsWith('.pack-')) throw new Error('Unsafe package staging cleanup');
  await rm(staging, { recursive: true, force: true });
}
