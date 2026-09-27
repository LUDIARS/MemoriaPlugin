import { valid, validRange, satisfies } from 'semver';

/** Portable metadata: neither the distribution backend nor the consuming app owns this contract. */
export interface PackageManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  name: string;
  description: string;
  icon: string;
  runtime: 'node-esm';
  hostApi: { id: string; range: string };
  entry: string;
  capabilities: string[];
}

export interface ReleaseDescriptor {
  manifest: PackageManifest;
  artifact: { url: string; size: number; sha256: string };
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}

export function packageId(value: unknown): string {
  const id = text(value, 'package id', 80);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(id)) {
    throw new Error('Invalid package id');
  }
  return id;
}

export function packageVersion(value: unknown): string {
  const version = text(value, 'package version', 100);
  if (valid(version) !== version) throw new Error('Version must be canonical SemVer');
  return version;
}

/** Reject names Windows would normalize to a different path, even on Unix hosts. */
export function packagePath(value: unknown): string {
  const path = text(value, 'package path', 240);
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' ||
    /[\\\x00-\x1f\x7f:<>"|?*]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe package path');
  return path;
}

export function parseManifest(value: unknown): PackageManifest {
  const m = object(value);
  const host = object(m.hostApi);
  if (m.schemaVersion !== 1 || m.runtime !== 'node-esm') throw new Error('Unsupported package format/runtime');
  const range = text(host.range, 'host API range');
  if (!validRange(range)) throw new Error('Invalid host API range');
  if (!Array.isArray(m.capabilities) || m.capabilities.length > 100) throw new Error('Invalid capabilities');
  const entry = packagePath(m.entry);
  if (!/\.(m?js)$/.test(entry)) throw new Error('Entry must be compiled JavaScript');
  return {
    schemaVersion: 1, id: packageId(m.id), version: packageVersion(m.version),
    name: text(m.name, 'name'), description: typeof m.description === 'string' ? m.description.slice(0, 2000) : '',
    icon: text(m.icon, 'icon', 32), runtime: 'node-esm',
    hostApi: { id: packageId(host.id), range }, entry,
    capabilities: m.capabilities.map((cap) => text(cap, 'capability', 100)),
  };
}

export function parseRelease(value: unknown): ReleaseDescriptor {
  const release = object(value);
  const artifact = object(release.artifact);
  const sha256 = text(artifact.sha256, 'digest');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid SHA-256 digest');
  if (!Number.isSafeInteger(artifact.size) || Number(artifact.size) <= 0) throw new Error('Invalid artifact size');
  const artifactUrl = text(artifact.url, 'artifact URL', 2048);
  const parsedUrl = new URL(artifactUrl, 'https://package.invalid/');
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error('Artifact URLs must not contain credentials, query tokens or fragments');
  }
  return { manifest: parseManifest(release.manifest), artifact: {
    url: artifactUrl, size: Number(artifact.size), sha256,
  } };
}

export function assertCompatible(manifest: PackageManifest, host: { id: string; version: string }): void {
  if (manifest.hostApi.id !== host.id || !satisfies(host.version, manifest.hostApi.range)) {
    throw new Error('Package is not compatible with this host');
  }
}
