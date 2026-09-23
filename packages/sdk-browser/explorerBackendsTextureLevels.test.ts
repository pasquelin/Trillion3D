import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareExplorerBackends } from './explorerBackends.ts';
import type { BackendContext, RenderBackend } from './backendTypes.ts';
import type { ClusterManifest } from '../sdk-core/src/index.ts';
import type { ExplorerSession } from './explorerSession.ts';

/**
 * Behaviour: the reader of baked texture levels follows the CACHE, not `textureSource`. Before
 * this batch it existed only under `'cache'`, so a default session regenerated on the GPU every
 * mip level the compiler had already baked and filed beside the pages. A host that asks for
 * `'host'` asks the LOADER for the source images — for a backend that draws the host scene — and
 * that is all it asks: the engine still reads the levels.
 */
const metadata = (textures?: { url: string }) =>
  ({ primitives: [], textures }) as unknown as ClusterManifest;

async function run(options: { textureSource?: 'host' | 'cache' }, cacheTextures?: { url: string }) {
  let seen: BackendContext | undefined;
  const backend: RenderBackend = {
    id: 'probe',
    prepare: async () => {},
    dispose: () => {},
  } as unknown as RenderBackend;
  const session = {
    canvas: { width: 4, height: 4 },
    options: { ...options, importedLights: false },
    scope: 'full',
    metadata: metadata(cacheTextures),
    diagnosticChannel: { enabled: false, detail: 'summary', emit: () => {} },
    emit: () => {},
    diagnose: () => {},
  } as unknown as ExplorerSession;
  await prepareExplorerBackends(session, {
    source: {} as never,
    associations: new Map(),
    textureIndices: new Map(),
    pageSources: {
      indices: new Map<string, Uint32Array>(),
      streamer: { read: async () => undefined, readBytes: async () => undefined },
      attachCap: 1,
      cacheCap: 1,
      preload: 'visible',
    } as never,
    directGpu: false,
    factories: [
      (context) => {
        seen = context;
        return backend;
      },
    ],
    backends: [],
    base: 'http://localhost/cache/',
  });
  return seen!;
}

test('the baked-level reader follows the cache, not the texture-source option', async () => {
  // `createTextureLevelReader` needs the browser decoder to hand a level back; Node has none.
  const scope = globalThis as { createImageBitmap?: unknown };
  scope.createImageBitmap = async () => ({});
  try {
    for (const textureSource of ['cache', 'host', undefined] as const) {
      const context = await run(textureSource ? { textureSource } : {}, { url: 'textures/v4' });
      assert.equal(
        typeof context.readTextureLevel,
        'function',
        `a cache with baked chains hands the reader over under ${textureSource ?? 'the default'}`,
      );
    }
  } finally {
    delete scope.createImageBitmap;
  }
});

test('a cache that bakes no texture chain hands no reader over', async () => {
  const context = await run({ textureSource: 'cache' }, undefined);
  assert.equal(context.readTextureLevel, undefined);
});
