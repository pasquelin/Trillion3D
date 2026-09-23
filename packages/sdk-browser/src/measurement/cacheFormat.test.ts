import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { openMeasuredWorld } from './measurement.ts';
import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  EngineError,
  FORMAT_VERSION,
} from '../../../sdk-core/src/index.ts';

/** A page location for the test's lifetime, the previous one given back after. */
function stubLocation(t: TestContext) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'http://localhost/' },
  });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'location', prior);
    else Reflect.deleteProperty(globalThis, 'location');
  });
}

/** The cache's pointer or its empty cluster metadata, both at `version`. */
function cacheResponse(pointer: boolean, version: number) {
  return new Response(
    JSON.stringify(
      pointer
        ? { status: 'ready', scope: 'full', formatVersion: version, url: 'clusters.json' }
        : {
            status: 'ready',
            scope: 'full',
            schema: version,
            formatVersion: version,
            selectedNodes: [],
            selectedTriangles: 0,
            errorModel: 'dag-group-qem-v1',
            clusterStrategy: 'dag-groups',
            primitives: [],
          },
    ),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

/** Opens the full cache on a canvas that has no context under Node; rejects with `code`. */
function assertOpenRejects(code: string) {
  return assert.rejects(
    openMeasuredWorld({ nodeName: 'CANVAS', getContext() {} } as unknown as HTMLCanvasElement, {
      manifestUrl: 'http://localhost/manifest.json',
      scope: 'full',
    }),
    (error: unknown) => error instanceof EngineError && error.code === code,
  );
}

for (const version of [FORMAT_VERSION, CLUSTERED_BLEND_FORMAT_VERSION])
  test(`explorer accepts format ${version} pointer and metadata before loading the source`, async (t) => {
    stubLocation(t);
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) =>
      cacheResponse(String(input).endsWith('manifest.json'), version),
    );
    const load = t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => {
      throw new Error('source-load-boundary');
    });
    // #274: the machine is read before the source. An accepted format therefore stops at the
    // capability floor here — no WebGL2 under Node — and never asks for the glTF.
    await assertOpenRejects('NO_WEBGL2');
    assert.equal(load.mock.callCount(), 0);
  });
test('explorer rejects an unsupported pointer format before requesting metadata', async (t) => {
  stubLocation(t);
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads++;
    return cacheResponse(reads === 1, 1);
  });
  await assertOpenRejects('UNSUPPORTED_FORMAT');
  assert.equal(reads, 1);
});
