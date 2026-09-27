import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { readDistributionConfig } from '../src/distribution/service-config.js';
import { assembleCatalog } from '../src/distribution/catalog.js';
import { promotePublication } from '../src/distribution/publication.js';
import { packagePath, packageVersion, object, parseManifest } from '../src/packages/contract.js';
import { readFile } from 'node:fs/promises';

const run = promisify(execFile);
const root = process.cwd();
const config = readDistributionConfig(root);
await mkdir(config.storage, { recursive: true });
const lockPath = join(config.storage, '.build.lock');
const lock = await open(lockPath, 'wx');
let stage: string | undefined;
try {
  // Ex serializes deployment requests; the file lock also excludes accidental local parallel builds.
  await mkdir(resolve(root, 'dist'), { recursive: true });
  stage = await mkdtemp(resolve(root, 'dist/.distribution-'));
  const descriptors: string[] = [];
  const output = join(stage, 'releases');
  for (const release of config.releases) {
    const source = packagePath(release.source);
    const version = packageVersion(release.version);
    const metadata = object(JSON.parse(await readFile(resolve(root, source, 'plugin.json'), 'utf8')));
    const manifest = parseManifest({ ...metadata, schemaVersion: 1, version, runtime: 'node-esm', entry: 'plugin.js' });
    await run(process.execPath, ['--import', 'tsx', 'scripts/package.ts', source, version, output],
      { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    descriptors.push(join(output, `${manifest.id}-${manifest.version}.json`));
  }
  const catalog = join(stage, 'public');
  await assembleCatalog(catalog, descriptors);
  await build({ entryPoints: [resolve(root, 'src/distribution/server.ts')],
    outfile: resolve(root, 'dist/distribution/server.js'), bundle: true, platform: 'node',
    target: 'node22', format: 'esm', packages: 'external', sourcemap: false });
  const revision = await run('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  const pkg = object(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')));
  await writeFile(resolve(root, 'dist/distribution/version.txt'), `${String(pkg.version)}\n${revision.stdout.trim()}\n`);
  // All build steps succeeded. Old running processes retain their validated catalog snapshot.
  await promotePublication(catalog, config.storage);
  console.info('Distribution build complete; catalog promoted. Restart through Excubitor to activate.');
} finally {
  try {
    if (stage) await rm(stage, { recursive: true }); // Only the mkdtemp directory owned by this build.
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}
