import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareExplorerBackends } from './backends.ts';
import { createExplorerPageSources } from './pageSources.ts';
import { createPageCache } from '../../streaming/pageCache.ts';
import { sha256Hex } from '../../measurement/sha256Hex.ts';
import {
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type ClusterManifest,
} from '../../../../sdk-core/src/index.ts';
import type { BackendContext } from '../../backend/types.ts';
import type { ExplorerSession } from './session.ts';

const base = 'http://localhost/cache/';

/** A one-triangle proxy file, and the manifest that names it. */
async function servedProxy() {
  const words = new Uint32Array(4 + 9 + 1);
  words.set([SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION, 1, 0]);
  new Float32Array(words.buffer, 16, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const proxy = {
    version: SCENE_PROXY_VERSION,
    url: 'proxy.bin',
    sha256: await sha256Hex(words.buffer),
    bytes: words.byteLength,
    triangles: 1,
    nodes: 0,
    bounds: [0, 0, 0, 1, 1, 0],
  };
  const fetched: string[] = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(words.slice(), { status: 200 });
  };
  return { metadata: { primitives: [], proxy } as unknown as ClusterManifest, fetched };
}

/** One session on the world's kept cache, as far as its engines' context: what they read. */
async function openSession(
  metadata: ClusterManifest,
  pageCache: ReturnType<typeof createPageCache>,
) {
  const diagnosticChannel = { enabled: false, detail: 'summary', emit: () => {} };
  const options = { manifestUrl: `${base}manifest.json`, pageCache, importedLights: false };
  const pageSources = await createExplorerPageSources(
    metadata,
    options,
    base,
    undefined,
    true,
    [],
    diagnosticChannel as never,
    () => {},
  );
  let context: BackendContext | undefined;
  const session = {
    canvas: { width: 4, height: 4 },
    options,
    scope: 'full',
    metadata,
    diagnosticChannel,
    emit: () => {},
    diagnose: () => {},
  } as unknown as ExplorerSession;
  await prepareExplorerBackends(session, {
    source: {} as never,
    associations: new Map(),
    textureIndices: new Map(),
    pageSources,
    directGpu: false,
    factories: [
      (seen) => {
        context = seen;
        return { id: 'probe', prepare: async () => {}, dispose: () => {} } as never;
      },
    ],
    backends: [],
    base,
  });
  return { context: context!, close: () => pageSources.streamer.dispose() };
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
