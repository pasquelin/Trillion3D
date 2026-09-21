// Still pose, cache that applies arrivals: the cut must converge to ONE cover and stop
// asking. Two equivalent covers took turns as arrivals landed, with permanent requests —
// the prefetch ring, asked even when the visible cut was incomplete, fought the cache with
// what the frame shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from './index.ts';
import { drawnIndices } from './pagesBackendFixture.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { submittedDraws } from './clusterBatchMesh.ts';

/** The Three engine on the DAG fixture, with no page in memory at the start. */
function engine() {
  const fixture = dagFixture();
  const backend = exactPagesBackend({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: new Map<string, Uint32Array>(),
    associations: fixture.associations,
    pixelError: 0.05,
    viewport: [1280, 720] as [number, number],
  });
  return { backend, octets: fixture.indices, dispose: () => fixture.geometry.dispose() };
}

/** Displayed cover, in order: that is what must be a fixed point. */
const couverture = (backend: ReturnType<typeof exactPagesBackend>) =>
  submittedDraws(backend)
    .map((draw) => `${draw.renderOrder}:${drawnIndices(draw).join('/')}`)
    .join(',');

/** One frame: cut, then arrival of what the engine asked for, like a cache that answers. */
function image(
  backend: ReturnType<typeof exactPagesBackend>,
  octets: Map<string, Uint32Array>,
  camera = wideCamera(),
) {
  backend.render(camera);
  const demandes = [...backend.pendingUrls!(), ...backend.prefetchUrls!()];
  for (const url of demandes) {
    const bytes = octets.get(url);
    if (bytes) backend.acceptPage!(url, bytes);
  }
  backend.syncResident!();
  return demandes;
}

test('still pose: the cut converges to a cover and stops asking', () => {
  const { backend, octets, dispose } = engine();
  const camera = wideCamera();
  // Ten frames are plenty to drain a seven-page hierarchy.
  for (let i = 0; i < 10; i++) image(backend, octets, camera);
  const converge = backend.metrics().clusters;
  const couvertures = new Set<string>();
  let demandesApres = 0;
  for (let i = 0; i < 8; i++) {
    demandesApres += image(backend, octets, camera).length;
    couvertures.add(couverture(backend));
    assert.equal(backend.metrics().clusters, converge, 'the cluster count has changed');
  }
  assert.equal(couvertures.size, 1, `the cut alternates between ${couvertures.size} covers`);
  assert.equal(demandesApres, 0, 'the engine is still asking while its cut is complete');
  backend.dispose();
  dispose();
});

test('the prefetch ring does not fight the cache with the visible cut', () => {
  const { backend, octets, dispose } = engine();
  const camera = wideCamera();
  backend.render(camera);
  assert.ok(backend.pendingUrls!().length > 0, 'the visible cut must be incomplete here');
  assert.deepEqual(
    backend.prefetchUrls!(),
    [],
    'the ring is asked while the frame still shows holes: it pushes out what the frame ' +
      'is waiting for, the cut falls back on a coarser substitute, and nothing converges',
  );
  // Once the visible cut is complete, the ring resumes its role: prefetch the neighbourhood.
  for (let i = 0; i < 10; i++) image(backend, octets, camera);
  assert.deepEqual(backend.pendingUrls!(), [], 'the visible cut is complete');
  backend.dispose();
  dispose();
});
