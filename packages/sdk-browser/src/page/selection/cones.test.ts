// Behaviour this batch changed: a root declares its cones once and for all, and the cut trusts
// that declaration instead of reading `cone` on each kept cluster. The declaration is therefore
// a contract, and these three tests hold both ends — who writes it, who reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages, type PageRec } from './selection.ts';
import { blendFixture, camera } from './blend.fixture.ts';
import type { ClusterRoot } from './types.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

/** A fixture whose nearest page carries a cone that looks opposite the camera: honoured, it
 *  rejects it; ignored, it stays. The material is single-sided, without which cone reject has
 *  nothing to say. */
function fixtureAvecCone() {
  const fixture = blendFixture(new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  collected.allPages[0].cone = { axis: [0, 0, -1], angle: 0 };
  return { fixture, ...collected };
}

function urls(roots: ReadonlyArray<ClusterRoot<PageRec>>) {
  return selectVisiblePages(roots, cameraMoteur(camera()), {}).shown.map((page) => page.url);
}

test('collection declares a root without a cone, which is true of all its pages', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.ok(roots.length > 0);
  for (const root of roots) assert.equal(root.cones, false);
  for (const page of allPages) assert.equal(page.cone, undefined);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('a root that declares it carries cones rejects by its cone, as before this batch', () => {
  const { fixture, roots } = fixtureAvecCone();
  // `true` and silence say the same thing: test each page. The second is what every root
  // returned before this batch, and it is the previous answer that must come back.
  roots[0].cones = true;
  const declare = urls(roots);
  roots[0].cones = undefined;
  assert.deepEqual(urls(roots), declare);
  assert.ok(!declare.includes('near'));
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('a root that declares it has no cone no longer reads `cone`: the cluster is kept', () => {
  const { fixture, roots } = fixtureAvecCone();
  roots[0].cones = false;
  assert.ok(urls(roots).includes('near'));
  fixture.geometry.dispose();
  fixture.material.dispose();
});
