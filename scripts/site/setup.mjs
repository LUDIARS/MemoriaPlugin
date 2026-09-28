import { fileURLToPath } from 'node:url';
import { runNpm } from './npm.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Use the existing publisher: published versions remain immutable.
await runNpm(root, ['ci', '--include=dev', '--no-audit', '--no-fund']);
await runNpm(root, ['run', 'build:distribution']);
