// Behaviour this batch changed: a root declares once that each of its pages carries its box,
// and the cut stops checking it per cluster under a node entirely in the frustum. The
// declaration is a contract; these three tests hold both ends — who writes it, who reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages, selectVisiblePages, type PageRec } from './selection.ts';
import { wideCamera } from './dag.fixture.ts';
import { culledDagRoots, HELD_EXACT_ASK } from './helpers.fixture.ts';
import { blendFixture } from './blend.fixture.ts';
import type { ClusterRoot } from './types.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

// The wide camera sees the whole root of `culledDagRoots`: the descent sets `inside` from the
// first node, and that is the only case where the declaration changes anything.
const montres = (roots: ReadonlyArray<ClusterRoot<PageRec>>) =>
  selectVisiblePages(roots, cameraMoteur(wideCamera()), HELD_EXACT_ASK).shown.map(
    (page) => page.url,
  );

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
  const { fixture, roots } = culledDagRoots();
  const declare = montres(roots);
  roots[0].boxes = undefined;
  assert.deepEqual(montres(roots), declare);
  assert.ok(declare.length > 0);
  fixture.geometry.dispose();
});

test('without a declaration, a page without a box is dropped; declared, the cut no longer reads it', () => {
  const { fixture, roots } = culledDagRoots();
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
