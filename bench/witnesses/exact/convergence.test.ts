// Still pose, cache that applies arrivals: the cut must converge to ONE cover and stop
// asking. Two equivalent covers took turns as arrivals landed, with permanent requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exactPagesBackend } from '../measurement.ts';
import { drawnIndices } from '../../../packages/sdk-browser/src/backend/pagesBackend.fixture.ts';
import {
  dagFixture,
  wideCamera,
} from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts';
import { isClusterDrawMesh } from '../../../packages/sdk-browser/src/cluster/batchMesh.ts';
import { submittedDraws } from '../../../packages/sdk-browser/src/cluster/submissions.fixture.ts';

/** The exact witness on the DAG fixture, with no page in memory at the start. */
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
    .map((draw) => {
      assert.ok(isClusterDrawMesh(draw), 'the exact pages backend only submits batch records');
      return `${draw.renderOrder}:${drawnIndices(draw).join('/')}`;
    })
    .join(',');

/** One frame: cut, then arrival of what the engine asked for, like a cache that answers. */
function image(
  backend: ReturnType<typeof exactPagesBackend>,
  octets: Map<string, Uint32Array>,
  camera = wideCamera(),
) {
  backend.render(camera);
  const requests = [...backend.pendingUrls!()];
  for (const url of requests) {
    const bytes = octets.get(url);
    if (bytes) backend.acceptPage!(url, bytes);
  }
  backend.syncResident!();
  return requests;
}

test('still pose: the cut converges to a cover and stops asking', () => {
  const { backend, octets, dispose } = engine();
  const camera = wideCamera();
  // Ten frames are plenty to drain a seven-page hierarchy.
  for (let i = 0; i < 10; i++) image(backend, octets, camera);
  const converge = backend.metrics().clusters;
  const couvertures = new Set<string>();
  let requestsAfter = 0;
  for (let i = 0; i < 8; i++) {
    requestsAfter += image(backend, octets, camera).length;
    couvertures.add(couverture(backend));
    assert.equal(backend.metrics().clusters, converge, 'the cluster count has changed');
  }
  assert.equal(couvertures.size, 1, `the cut alternates between ${couvertures.size} covers`);
  assert.equal(requestsAfter, 0, 'the engine is still asking while its cut is complete');
  backend.dispose();
  dispose();
});
