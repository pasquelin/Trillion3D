import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from '../../../../bench/witnesses/measurement.ts';
import { fixture, camera } from '../../../../tests/fixtures/bootstrapOrder.ts';

test('the root cover is the first thing a cold explorer asks for, and the only thing', () => {
  const scene = fixture();
  const backend = exactPagesBackend({
    source: scene.source,
    metadata: scene.metadata,
    indices: new Map(),
    associations: scene.associations,
    pixelError: 0,
    viewport: [1280, 720] as [number, number],
  });
  backend.render(camera());
  // Nothing is resident: the cut wants the leaves, but what is asked for is the fallback cover.
  assert.deepEqual(
    backend.pendingUrls?.(),
    ['bundle-roots'],
    'the coarse complete cover comes first',
  );
  assert.ok(backend.pageUrls?.().includes('bundle-roots'), 'and is retained against eviction');
  // The root bundle lands: the scene is drawable, and only now is the detail asked for.
  backend.acceptPage?.('bundle-roots', new Uint32Array([0, 1, 2]));
  backend.render(camera());
  assert.equal(
    backend.metrics().submittedTriangles,
    1,
    'the root alone already covers the surface',
  );
  const next = backend.pendingUrls?.();
  assert.ok(
    next && next.length > 0 && !next.includes('bundle-roots'),
    'the detail follows the cover',
  );
  // The cut the camera asked for, closed over its groups as the engine asks (#486): the leaves
  // are drawn only once their group and every group above it are resident.
  assert.deepEqual(
    [...(next ?? [])].sort(),
    ['bundle-leaves', 'bundle-mid'],
    'and it is the cut the camera asked for, whole groups',
  );
  backend.dispose();
  scene.geometry.dispose();
  scene.material.dispose();
});

test('the ring a prefetch pulls is the next finer level, and only once nothing visible is missing', () => {
  const scene = fixture();
  const backend = exactPagesBackend({
    source: scene.source,
    metadata: scene.metadata,
    indices: new Map(),
    associations: scene.associations,
    pixelError: 8,
    viewport: [1280, 720] as [number, number],
  });
  backend.render(camera());
  backend.acceptPage?.('bundle-roots', new Uint32Array([0, 1, 2]));
  backend.render(camera());
  // Eight pixels of budget put the cut on the mid clusters; half of it reaches the leaves. The
  // certified bound of defect 3 announces more than the old under-estimate for the same
  // spheres, so the same intent needs a wider budget than the four pixels this test used.
  assert.deepEqual(backend.pendingUrls?.(), ['bundle-mid'], 'the cut comes before any ring');
  backend.acceptPage?.('bundle-mid', new Uint32Array([0, 1, 2, 3, 4, 5]));
  backend.render(camera());
  assert.deepEqual(backend.pendingUrls?.(), [], 'nothing visible is missing');
  assert.deepEqual(backend.prefetchUrls?.(), ['bundle-leaves'], 'the ring is the next finer level');
  backend.dispose();
  scene.geometry.dispose();
  scene.material.dispose();
});
