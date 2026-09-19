// Behaviour changed by this batch: the two cut lists are no longer cleared with
// `length = 0` each frame — they lost their capacity and grew it back from zero to
// eighty thousand — but rewritten by index, their length set once at the end.
// What must stay true: a cut shorter than the previous one leaves nothing behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { dagCulling } from './pageSelectionTestHelpers.ts';
import { cameraMoteur } from './cameraFixture.ts';

const ASK = { pixelError: 0, viewport: [1280, 720] as [number, number], holdResident: true };

function racines() {
  const fixture = dagFixture();
  fixture.metadata.primitives[0].culling = dagCulling();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  return { fixture, roots };
}

/** A camera that sees none of the model: its cut is empty. */
function ailleurs() {
  const cam = new THREE.PerspectiveCamera(20, 16 / 9, 0.1, 1000);
  cam.position.set(1000, 1000, 1000);
  cam.lookAt(2000, 2000, 2000);
  cam.updateMatrixWorld();
  return cam;
}

test('reused lists keep nothing from the previous cut, shorter or empty', () => {
  const { fixture, roots } = racines();
  const shown: PageRec[] = [],
    wanted: PageRec[] = [];
  const large = selectVisiblePages(roots, cameraMoteur(wideCamera()), { ...ASK, wanted }, shown);
  const pleine = large.shown.length;
  assert.ok(pleine > 0);
  assert.equal(large.wanted.length, pleine);

  const vide = selectVisiblePages(roots, cameraMoteur(ailleurs()), { ...ASK, wanted }, shown);
  assert.equal(vide.shown.length, 0);
  assert.equal(vide.wanted.length, 0);
  assert.equal(shown.length, 0);
  assert.equal(wanted.length, 0);
  // Neither hole nor leftover: what the host walks is exactly this frame's cut.
  assert.deepEqual([...shown], []);
  assert.equal(vide.selectedTriangles, 0);
  assert.equal(vide.displayedTriangles, 0);

  // And the list returns to its full length without keeping a trace of the empty pass.
  const encore = selectVisiblePages(roots, cameraMoteur(wideCamera()), { ...ASK, wanted }, shown);
  assert.equal(encore.shown.length, pleine);
  assert.deepEqual(
    encore.shown.map((page) => page.url),
    large.shown.map((page) => page.url),
  );
  assert.ok(encore.shown.every((page) => page !== undefined));
  fixture.geometry.dispose();
});
