import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { buildRegistry } from '../host/runtime.js';
import type { PluginSource } from '../host/discovery.js';
import type { CapabilityProviders } from '../host/capabilities.js';
import type { SqliteLike } from '../host/sqlite.js';

test('listing is lazy, concurrent first requests activate once and reload disposes before reconnecting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mmp-lifecycle-'));
  let imports = 0;
  let active = 0;
  let activations = 0;
  let failImport = false;
  const source: PluginSource = {
    metadata: { id: 'example', name: 'Example', icon: 'E' }, dir: root, entryFile: join(root, 'plugin.js'),
    async load() {
      if (failImport) throw new Error('bad replacement');
      imports++;
      return { id: 'example', name: 'Example', icon: 'E', routes: (app) => { app.get('/', (c) => c.text('ready')); },
        async activate(ctx) {
          assert.equal(active, 0);
          active++; activations++;
          ctx.onDispose?.(() => { active--; });
        } };
    },
  };
  const app = new Hono();
  const registry = await buildRegistry(app, [source], { dataDir: root, sqlite: {} as SqliteLike, capabilities: {} as CapabilityProviders });
  try {
    assert.equal(registry.manifest()[0]?.status, 'inactive');
    assert.equal(imports, 0);
    const responses = await Promise.all([app.request('/plugins/example/'), app.request('/plugins/example/')]);
    assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ['ready', 'ready']);
    assert.equal(activations, 1);
    failImport = true;
    await assert.rejects(registry.reload('example'), /bad replacement/);
    assert.equal(active, 1);
    assert.equal(await (await app.request('/plugins/example/')).text(), 'ready');
    failImport = false;
    await registry.reload('example');
    assert.equal(active, 1);
    assert.equal(activations, 2);
  } finally { await registry.dispose(); await rm(root, { recursive: true, force: true }); }
  assert.equal(active, 0);
});
