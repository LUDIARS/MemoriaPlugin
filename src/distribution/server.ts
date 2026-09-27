import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDistributionConfig } from './service-config.js';
import { loadPublication } from './publication.js';
import { distributionAccess } from './http-access.js';
import { distributionHandler } from './http-handler.js';

const root = process.cwd();
const config = readDistributionConfig(root);
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ex must supply a valid PORT');
const host = process.env.HOST ?? '127.0.0.1';
if (host !== '127.0.0.1' && host !== '::1') throw new Error('Distribution backend must bind to loopback');
const publication = await loadPublication(config.storage);
const [version, gitHash] = (await readFile(resolve(root, 'dist/distribution/version.txt'), 'utf8')).trim().split('\n');
if (!version || !gitHash || !/^[a-f0-9]{40,64}$/.test(gitHash)) throw new Error('Invalid build identity');
const handle = distributionHandler(publication, distributionAccess(process.env), version, gitHash);
const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', event: 'distribution_request_failed',
      code: (error as NodeJS.ErrnoException).code ?? 'unknown' }));
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(JSON.stringify({ level: 'fatal', event: 'distribution_server_error', code: error.code }));
  process.exitCode = 1;
});
server.listen(port, host, () => console.info(JSON.stringify({ level: 'info', event: 'distribution_listening', port })));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  server.close((error) => { if (error) { console.error('Distribution shutdown failed'); process.exitCode = 1; } });
  server.closeAllConnections();
});
