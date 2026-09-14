import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createExplorer } from './index.ts';
import { EngineError } from '../sdk-core/index.ts';

for (const version of [1, 2])
  test(`explorer accepts format ${version} pointer and metadata before loading the source`, async (t) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'http://localhost/' },
    });
    t.after(() => {
      if (prior) Object.defineProperty(globalThis, 'location', prior);
      else Reflect.deleteProperty(globalThis, 'location');
    });
    t.mock.method(
      globalThis,
      'fetch',
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('manifest.json')
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
        ),
    );
    const sourceBoundary = new Error('source-load-boundary');
    t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => {
      throw sourceBoundary;
    });
    await assert.rejects(
      createExplorer({} as HTMLCanvasElement, {
        manifestUrl: 'http://localhost/manifest.json',
        scope: 'full',
      }),
      (error) => error === sourceBoundary,
    );
  });
test('explorer rejects an unsupported pointer format before requesting metadata', async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'http://localhost/' },
  });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'location', prior);
    else Reflect.deleteProperty(globalThis, 'location');
  });
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads++;
    return new Response(
      JSON.stringify(
        reads === 1
          ? { status: 'ready', scope: 'full', formatVersion: 3, url: 'clusters.json' }
          : {
              status: 'ready',
              scope: 'full',
              schema: 3,
              formatVersion: 3,
              selectedNodes: [],
              selectedTriangles: 0,
              errorModel: 'dag-group-qem-v1',
              clusterStrategy: 'dag-groups',
              primitives: [],
            },
      ),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
  await assert.rejects(
    createExplorer({} as HTMLCanvasElement, {
      manifestUrl: 'http://localhost/manifest.json',
      scope: 'full',
    }),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
  assert.equal(reads, 1);
});
