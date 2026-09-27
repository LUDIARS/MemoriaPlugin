import { parseRelease, object, type ReleaseDescriptor } from './contract.js';

export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_CATALOG_BYTES = 1024 * 1024;

/** Authentication is supplied by the app; credentials must not be persisted in the catalog. */
export interface CatalogSource {
  url: string;
  headers?: NonNullable<Parameters<typeof fetch>[1]>['headers'];
  fetch?: typeof fetch;
}

function catalogUrl(source: CatalogSource): URL {
  const url = new URL(source.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Catalog must use HTTPS without URL credentials or fragment');
  }
  return url;
}

async function boundedGet(source: CatalogSource, url: URL, max: number): Promise<Uint8Array> {
  const headers = new Headers(source.headers);
  headers.set('Cache-Control', 'no-store');
  const response = await (source.fetch ?? fetch)(url, {
    headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Package source returned HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('Package source returned an empty body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('Package response exceeds size limit');
      chunks.push(value);
    }
  } finally {
    // Cancellation releases the connection on failure or early size rejection.
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks, size);
}

export async function readCatalog(source: CatalogSource): Promise<ReleaseDescriptor[]> {
  const bytes = await boundedGet(source, catalogUrl(source), MAX_CATALOG_BYTES);
  const catalog = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.releases) || catalog.releases.length > 1000) {
    throw new Error('Invalid package catalog');
  }
  const releases = catalog.releases.map(parseRelease);
  const identities = new Set<string>();
  for (const release of releases) {
    const key = `${release.manifest.id}@${release.manifest.version}`;
    if (identities.has(key)) throw new Error('Duplicate package release');
    identities.add(key);
  }
  return releases;
}

export async function downloadPackage(source: CatalogSource, release: ReleaseDescriptor): Promise<Uint8Array> {
  const base = catalogUrl(source);
  const url = new URL(release.artifact.url, base);
  // Same-origin artifacts prevent catalog entries from redirecting bearer credentials or causing SSRF.
  if (url.origin !== base.origin || url.username || url.password || url.hash) throw new Error('Untrusted artifact origin');
  if (release.artifact.size > MAX_ARCHIVE_BYTES) throw new Error('Package exceeds archive limit');
  return boundedGet(source, url, release.artifact.size);
}
