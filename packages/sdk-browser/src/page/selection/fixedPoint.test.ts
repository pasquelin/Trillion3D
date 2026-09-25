// Still pose: the cut is a fixed point, and the walk that finds it must be counted once. A missing
// page changes what the cut rule draws in its place, never the walk: two frames carrying exactly
// the same cut report the same walk, or the held-frame gate never sees them as identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { collectClusterPages, selectVisiblePages, type PageRec } from './selection.ts';
import { dagFixture } from './dag.fixture.ts';
import { createWebglFrameGate } from '../../webgl/core/frameGate.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

/** DAG fixture, every page resident, tight view on the left half: right-hand clusters
 *  leave the frustum and get counted there. */
function coupe() {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const pages = roots.flatMap((root) => root.pages);
  for (const page of pages) page.array = new Uint32Array([0, 1, 2]);
  const camera = G.perspectiveCamera(20, 1, 0.1, 1000);
  camera.position.set(-1, 0, 2);
  camera.lookAt(-1, 0, 0);
  camera.updateMatrixWorld();
  const shown: PageRec[] = [],
    wanted: PageRec[] = [];
  const options = {
    pixelError: 0.05,
    viewport: [1280, 720] as [number, number],
    holdResident: true,
    wanted,
  };
  return {
    pages,
    shown,
    tour: () => selectVisiblePages(roots, cameraMoteur(camera), options, shown),
  };
}

const identifiants = (recs: ReadonlyArray<PageRec>) => recs.map((rec) => rec.id).join(',');

test('identical pose: two consecutive cuts return the same cut, page for page', () => {
  const { tour } = coupe();
  const premiere = tour();
  const ids = identifiants(premiere.shown);
  const rejets = premiere.frustumRejected;
  for (let i = 0; i < 3; i++) {
    const suivante = tour();
    assert.equal(identifiants(suivante.shown), ids, 'the cut changed while nothing moved');
    assert.equal(suivante.frustumRejected, rejets, 'the walk counter changed');
  }
});

test("a missing page changes the cut drawn, not the walk's count", () => {
  const { pages, tour } = coupe();
  const sansRepli = tour();
  const rejets = sansRepli.frustumRejected;
  // The list is reused from one cut to the next: its contents are read before the next cut.
  const ids = identifiants(sansRepli.shown);
  assert.ok(rejets > 0, 'the view must reject clusters for the count to mean anything');
  // A missing page: its ancestor is drawn, the number of clusters outside the frustum stays.
  pages.find((page) => page.url === 'leaf0')!.array = undefined;
  const avecRepli = tour();
  assert.notEqual(identifiants(avecRepli.shown), ids, 'the ancestor was not drawn');
  assert.equal(avecRepli.frustumRejected, rejets, 'the walk was counted differently');
});

test('the held-frame gate rests on the cut, not on the walk counter', () => {
  const gate = createWebglFrameGate();
  const a = [{ id: 3 }, { id: 7 }] as PageRec[];
  const b = [{ id: 7 }, { id: 3 }] as PageRec[];
  gate.keep(2, 100, a, 0, false);
  gate.keep(2, 100, a, 0, false);
  assert.equal(gate.held(), true, 'two frames of an identical cut must be held');
  // Same page count and same triangles, but not the same pages nor the same order.
  gate.keep(2, 100, b, 0, false);
  assert.equal(gate.held(), false, 'a different cut must never be held');
});
