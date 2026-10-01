import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSceneProxyReader } from './proxyLoad.ts';
import { createPageCache } from '../streaming/pageCache.ts';
import { sha256Hex } from '../streaming/sha256Hex.ts';
import type { SceneProxyDescriptor } from '../../../sdk-core/src/index.ts';

test('shared expansion is decoded once across concurrent readers and sessions, and charged to CPU memory', async (t) => {
  const bytes = new Uint8Array(
    readFileSync(
      new URL('../../../sdk-core/src/scene/core/fixtures/proxy-v5.bin', import.meta.url),
    ),
  );
  const [, version, triangles, nodes, groups, owners, instances] = new Uint32Array(bytes.buffer);
  const descriptor: SceneProxyDescriptor = {
    version,
    triangles,
    nodes,
    groups,
    owners,
    instances,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes.buffer),
    url: 'proxy.bin',
    bounds: [0, 0, 0, 1, 1, 1],
    errorMetres: 0,
    errorFloorMetres: 0,
    cellMetres: 0.5,
    triangleBudget: triangles,
  };
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(bytes.slice());
  });
  const cache = createPageCache();
  const read = createSceneProxyReader(descriptor, 'https://example.test/', cache)!;
  const [first, concurrent] = await Promise.all([read(), read()]);
  const reopened = createSceneProxyReader(descriptor, 'https://example.test/', cache)!;
  assert.equal((await reopened()).data, first.data);
  assert.equal(concurrent.data, first.data);
  assert.equal(requests, 1);
  assert.equal(cache.keptBytes, bytes.byteLength + triangles * 40 + instances * 128);
  assert.equal(first.data.triangles.byteLength, triangles * 36);
  const uncached = createSceneProxyReader(descriptor, 'https://example.test/', undefined)!;
  assert.equal((await uncached()).data, (await uncached()).data);
  assert.equal(requests, 2, 'one read and expansion without a world cache, too');
  const changed = createSceneProxyReader(
    { ...descriptor, errorMetres: 9 },
    'https://example.test/',
    cache,
  )!;
  assert.equal((await changed()).errorMetres, 9, 'each reader retains its manifest metadata');
  assert.equal((await changed()).data, first.data, 'metadata changes do not expand geometry again');
  const invalid = createSceneProxyReader(
    { ...descriptor, triangles: triangles + 1 },
    'https://example.test/',
    cache,
  )!;
  await assert.rejects(invalid(), /disagrees with its manifest/);
  cache.keepOnly();
  assert.equal(cache.keptBytes, 0);
});
