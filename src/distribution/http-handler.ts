import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Publication } from './publication.js';

/** Explicit routes only: neither arbitrary files nor plugin entry points are exposed. */
export function distributionHandler(
  publication: Publication,
  allowed: (host: string | undefined, origin: string | undefined) => boolean,
  version: string,
  gitHash: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const health = JSON.stringify({ status: 'ok', service: 'memoriaplugin-distribution', version, git_hash: gitHash,
    releases: publication.releases.length });
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!allowed(req.headers.host, req.headers.origin)) { res.writeHead(403); res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    const path = req.url?.split('?')[0];
    const body = path === '/health' ? health : path === '/catalog.json' ? publication.catalog : undefined;
    if (body !== undefined) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body) });
      res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    const name = path?.slice(1);
    const artifact = name && publication.artifacts.get(name);
    if (!artifact) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': artifact.size,
      'Cache-Control': 'public, max-age=31536000, immutable', ETag: `"${artifact.digest}"` });
    if (req.method === 'HEAD') { res.end(); return; }
    try { await pipeline(createReadStream(artifact.path), res); }
    catch (error) {
      // pipeline closes the file even when the client disconnects. Do not log user-controlled URLs.
      if (!req.destroyed) console.error(JSON.stringify({ level: 'error', event: 'artifact_stream_failed',
        code: (error as NodeJS.ErrnoException).code ?? 'unknown' }));
    }
  };
}
