import { resolve } from 'node:path';
import { assembleCatalog } from '../src/distribution/catalog.js';

const [output, ...descriptors] = process.argv.slice(2);
if (!output || !descriptors.length) {
  throw new Error('Usage: npm run catalog -- <new-output-folder> <release.json> [release.json ...]');
}
await assembleCatalog(resolve(output), descriptors.map((path) => resolve(path)));
