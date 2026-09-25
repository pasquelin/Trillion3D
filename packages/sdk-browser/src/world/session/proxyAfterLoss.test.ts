import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBackendContext } from './backends.fixture.ts';
import { createExplorerPageSources } from './pageSources.ts';
import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import { createPageCache } from '../../streaming/pageCache.ts';
import { servedPages } from '../../streaming/servedPages.fixture.ts';
import {
  PROXY_TRIANGLE_FLOATS,
  SCENE_PROXY_HEADER_WORDS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type ClusterManifest,
} from '../../../../sdk-core/src/index.ts';

const base = 'http://localhost/cache/';

/** A one-triangle proxy file with no node, and the manifest that names it. */
async function servedProxy() {
  // The header, one triangle, its albedo.
  const words = new Uint32Array(SCENE_PROXY_HEADER_WORDS + PROXY_TRIANGLE_FLOATS + 1);
  words.set([SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION, 1, 0]);
  new Float32Array(words.buffer, SCENE_PROXY_HEADER_WORDS * 4, PROXY_TRIANGLE_FLOATS).set([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]);
  const { pages, fetched } = await servedPages(['proxy.bin'], new Uint8Array(words.buffer));
  const proxy = {
    ...pages[0],
    version: SCENE_PROXY_VERSION,
    triangles: 1,
    nodes: 0,
    bounds: [0, 0, 0, 1, 1, 0],
  };
  return { metadata: { primitives: [], proxy } as unknown as ClusterManifest, fetched };
}

/** One session on the world's kept cache, as far as its engines' context: what they read. */
async function openSession(
  metadata: ClusterManifest,
  pageCache: ReturnType<typeof createPageCache>,
  root = base,
) {
  const options = { manifestUrl: `${root}manifest.json`, pageCache };
  const pageSources = await createExplorerPageSources(
    metadata,
    options,
    root,
    undefined,
    true,
    [],
    createDiagnosticChannel(undefined),
    () => {},
  );
  const context = await probeBackendContext(metadata, pageSources, { options, base: root });
  return { context, close: () => pageSources.streamer.dispose() };
}

test('a session reopened after a device loss reads the resident proxy from the kept cache, fetching it once', async () => {
  const { metadata, fetched } = await servedProxy();
  const pageCache = createPageCache();
  const before = await openSession(metadata, pageCache);
  const lit = await before.context.readSceneProxy!();
  assert.equal(lit.triangles, 1);
  assert.deepEqual(fetched, [`${base}proxy.bin`]);
  // The device is lost: the session closes, the world keeps its cache and opens another.
  before.close();
  const after = await openSession(metadata, pageCache);
  const relit = await after.context.readSceneProxy!();
  assert.deepEqual(fetched, [`${base}proxy.bin`], 'the proxy it held is not fetched again');
  assert.deepEqual(relit.data.triangles, lit.data.triangles);
  assert.ok(pageCache.bytes >= metadata.proxy!.bytes, 'its bytes count against the CPU total');
  after.close();
});

test('another scene the world loads reads its own proxy, not the one kept under the same name', async () => {
  const { metadata, fetched } = await servedProxy();
  const pageCache = createPageCache();
  const first = await openSession(metadata, pageCache);
  await first.context.readSceneProxy!();
  first.close();
  const other = 'http://localhost/other/';
  const second = await openSession(metadata, pageCache, other);
  await second.context.readSceneProxy!();
  assert.deepEqual(fetched, [`${base}proxy.bin`, `${other}proxy.bin`]);
  second.close();
});

test('a proxy whose bytes are not the announced ones fails, naming the file and what differs', async () => {
  const { metadata } = await servedProxy();
  const announced = '0'.repeat(64);
  metadata.proxy!.sha256 = announced;
  const session = await openSession(metadata, createPageCache());
  await assert.rejects(
    session.context.readSceneProxy!(),
    new RegExp(
      `${base}proxy\\.bin after 3 attempts: .*SHA-256 [0-9a-f]{64}, ${announced} announced`,
    ),
  );
  session.close();
});
