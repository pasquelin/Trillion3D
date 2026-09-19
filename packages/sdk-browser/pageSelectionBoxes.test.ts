// Behaviour this batch changed: a root declares once that each of its pages carries its box,
// and the cut stops checking it per cluster under a node entirely in the frustum. The
// declaration is a contract; these three tests hold both ends — who writes it, who reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { dagCulling } from './pageSelectionTestHelpers.ts';
import { blendFixture } from './pageSelectionBlendFixture.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';
import { cameraMoteur } from './cameraFixture.ts';

const ASK = { pixelError: 0, viewport: [1280, 720] as [number, number], holdResident: true };

/** Test DAG with its hierarchy, whose wide camera sees the whole root: the descent sets
 *  `inside` from the first node, and that is the only case where the declaration changes anything. */
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

const montres = (roots: ReadonlyArray<ClusterRoot<PageRec>>) =>
  selectVisiblePages(roots, cameraMoteur(wideCamera()), ASK).shown.map((page) => page.url);

test('collection declares boxes, which is true of all its pages', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.ok(roots.length > 0);
  for (const root of roots) assert.equal(root.boxes, true);
  for (const page of allPages) {
    assert.equal(page.min.length, 3);
    assert.equal(page.max.length, 3);
  }
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('declaring boxes changes no cut when each page carries its own', () => {
  const { fixture, roots } = racines();
  const declare = montres(roots);
  roots[0].boxes = undefined;
  assert.deepEqual(montres(roots), declare);
  assert.ok(declare.length > 0);
  fixture.geometry.dispose();
});

test('without a declaration, a page without a box is dropped; declared, the cut no longer reads it', () => {
  const { fixture, roots } = racines();
  const sansBoite = roots[0].pages[0];
  sansBoite.min = undefined as unknown as number[];
  sansBoite.max = undefined as unknown as number[];
  roots[0].boxes = undefined;
  assert.ok(!montres(roots).includes(sansBoite.url));
  // The declaration is believed: the page passes without its box being read. That is what the
  // contract buys, and what makes an omission visible rather than silent.
  roots[0].boxes = true;
  assert.ok(montres(roots).includes(sansBoite.url));
  fixture.geometry.dispose();
});
