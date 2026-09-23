// Still pose: the cut is a fixed point, and the walk that finds it must be counted once.
// The forcing fallback redescends the tree after abandoning a first descent; frustum rejections
// from that abandoned descent were added to those of the kept descent. Two frames carrying
// exactly the same cut then reported two different walks, and the held-frame gate never saw
// them as identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
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
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 1000);
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

test('the forcing fallback does not count the descent it abandons', () => {
  const { pages, tour } = coupe();
  const sansRepli = tour();
  const rejets = sansRepli.frustumRejected;
  // The list is reused from one cut to the next: its contents are read before the next cut.
  const ids = identifiants(sansRepli.shown);
  assert.ok(rejets > 0, 'the view must reject clusters for the count to mean anything');
  // A missing page arms the fallback: the cut changes, the number of clusters outside the frustum does not.
  pages.find((page) => page.url === 'leaf0')!.array = undefined;
  const avecRepli = tour();
  assert.notEqual(identifiants(avecRepli.shown), ids, 'the fallback did not arm');
  assert.equal(avecRepli.frustumRejected, rejets, 'the abandoned descent is counted twice');
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
