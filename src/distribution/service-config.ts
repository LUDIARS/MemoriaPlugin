import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { object, text } from '../packages/contract.js';

export interface DistributionConfig {
  storage: string;
  releases: { source: string; version: string }[];
}

/** Shared by the offline publisher and the read-only server. No credentials live here. */
export function readDistributionConfig(root: string): DistributionConfig {
  const config = object(JSON.parse(readFileSync(resolve(root, 'deploy/distribution.json'), 'utf8')));
  if (!Array.isArray(config.releases) || config.releases.length === 0 || config.releases.length > 1000) {
    throw new Error('Expected 1 to 1000 explicitly selected releases');
  }
  return {
    storage: resolve(root, text(config.storage, 'distribution storage')),
    releases: config.releases.map((value) => {
      const release = object(value);
      return { source: text(release.source, 'release source'), version: text(release.version, 'release version') };
    }),
  };
}
