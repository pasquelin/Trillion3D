import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBackendContext } from './backends.fixture.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { ExplorerSession } from './session.ts';

/**
 * Behaviour: the reader of baked texture levels follows the CACHE, not `textureSource`. Before
 * this batch it existed only under `'cache'`, so a default session regenerated on the GPU every
 * mip level the compiler had already baked and filed beside the pages. A host that asks for
 * `'host'` asks the LOADER for the source images — for a backend that draws the host scene — and
 * that is all it asks: the engine still reads the levels.
 */
/** What the session reserved in the page cache for the engines' host tables, call by call. */
const reserved: number[] = [];
const metadata = (textures?: { url: string }) =>
  ({ primitives: [], textures }) as unknown as ClusterManifest;

const pageSources = {
  indices: new Map<string, Uint32Array>(),
  streamer: {
    read: async () => undefined,
    readBytes: async () => undefined,
    reserve: (bytes: () => number) => reserved.push(bytes()),
  },
  attachCap: 1,
  cacheCap: 1,
  preload: 'visible',
} as never;

const run = (
  options: { textureSource?: 'host' | 'cache' },
  cacheTextures?: { url: string },
  probe: Partial<RenderBackend> = {},
  session: Partial<ExplorerSession> = {},
) => probeBackendContext(metadata(cacheTextures), pageSources, { options, probe, session });

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

test("the engines' host tables are reserved in the page cache, read when it weighs itself", async () => {
  await run({}, undefined, { hostTableBytes: () => 1234 });
  assert.equal(reserved.at(-1), 1234);
  await run({});
  assert.equal(reserved.at(-1), 0, 'an engine without scene-sized tables reserves nothing');
});

test('an abort is a cancellation only when the session or the backend asked it; otherwise the WebGPU path falls back', async () => {
  const aborted = () => {
    throw new DOMException('closed', 'AbortError');
  };
  const probe = { id: 'webgpu-page-raster', prepare: async () => aborted() };
  const phases: string[] = [];
  const diagnose = (phase: string) => phases.push(phase);
  // Asked by neither: diagnosed, and the WebGPU path falls back (here to nothing, so no backend).
  await assert.rejects(run({}, undefined, probe, { diagnose } as never), /No backend/);
  assert.deepEqual(phases, ['backend-preparation-start', 'backend-preparation-error', 'fallback']);
  // Asked by the session, or by the backend's own signal: the abort goes up as it is, nothing
  // diagnosed, nothing fallen back.
  const cancel = new AbortController();
  cancel.abort();
  for (const [probeSignal, signal] of [
    [undefined, cancel.signal],
    [cancel.signal, undefined],
  ]) {
    phases.length = 0;
    await assert.rejects(
      run({}, undefined, { ...probe, signal: probeSignal }, { diagnose, signal } as never),
      { name: 'AbortError' },
    );
    assert.deepEqual(phases, ['backend-preparation-start']);
  }
});

test('a cancelled preparation waits for the release, and diagnoses one that fails', async () => {
  const cancel = new AbortController();
  cancel.abort();
  const signal = cancel.signal;
  const prepare = async () => {
    throw new DOMException('closed', 'AbortError');
  };
  let released = false;
  const slow = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    released = true;
  };
  await assert.rejects(run({}, undefined, { prepare, dispose: slow }, { signal } as never), {
    name: 'AbortError',
  });
  assert.equal(released, true, 'released before the cancellation goes up');
  const phases: string[] = [];
  const diagnose = (phase: string) => phases.push(phase);
  const failing = async () => {
    throw new Error('release failed');
  };
  await assert.rejects(
    run({}, undefined, { prepare, dispose: failing }, { diagnose, signal } as never),
    { name: 'AbortError' },
  );
  assert.deepEqual(phases, ['backend-preparation-start', 'backend-dispose-error']);
});

test('a failed preparation falls back without waiting for the release, still diagnosed', async () => {
  const prepare = async () => {
    throw new Error('prepare failed');
  };
  const phases: string[] = [];
  const diagnose = (phase: string) => phases.push(phase);
  const failing = async () => {
    await Promise.resolve();
    throw new Error('release failed');
  };
  const probe = { id: 'webgpu-page-raster', prepare, dispose: failing };
  await assert.rejects(run({}, undefined, probe, { diagnose } as never), /No backend/);
  await new Promise(setImmediate);
  assert.deepEqual(phases, [
    'backend-preparation-start',
    'backend-preparation-error',
    'fallback',
    'backend-dispose-error',
  ]);
});
