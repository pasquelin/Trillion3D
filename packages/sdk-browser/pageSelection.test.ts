import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, rootCoverage, selectVisiblePages } from './pageSelection.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { evaluateDagSelectionKernel, packDagSelection } from './gpuDagSelection.ts';
import { blendFixture, camera } from './pageSelectionBlendFixture.ts';

test('clustered blend pages retain their source and only select the intersecting part of a mesh', () => {
  const fixture = blendFixture();
  const { roots, allPages, blendCopies } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(blendCopies.length, 0);
  assert.equal(allPages.length, 2);
  for (const page of allPages) {
    assert.equal(page.transparent, true);
    assert.equal(page.sourceMesh, fixture.mesh);
  }
  const selected = selectVisiblePages(roots, camera(), {
    pixelError: 100,
    viewport: [960, 540],
    holdResident: true,
  });
  assert.deepEqual(
    selected.shown.map((page) => page.url),
    ['near'],
  );
  assert.equal(selected.displayedTriangles, 1);
  assert.equal(selected.complete, true);
  assert.deepEqual(
    rootCoverage(roots).map((page) => page.url),
    ['near', 'far'],
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('clustered blend never reports missing exact coverage as resident', () => {
  const fixture = blendFixture();
  fixture.indices.delete('near');
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
    { allowMissing: true },
  );
  const selected = selectVisiblePages(roots, camera(), { holdResident: true });
  assert.equal(selected.complete, false);
  assert.deepEqual(
    selected.wanted.map((page) => page.url),
    ['near'],
  );
  assert.deepEqual(selected.shown, []);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('double-sided blend pages survive backface cones in CPU and packed GPU selection', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  allPages[0].cone = { axis: [0, 0, -1], angle: 0 };
  const cam = camera(),
    packed = packDagSelection(roots);
  const cpu = selectVisiblePages(roots, cam, {});
  const gpu = evaluateDagSelectionKernel(packed, cameraSelectionUniforms(cam, 0, [960, 540]));
  assert.deepEqual(
    cpu.shown.map((page) => page.url),
    ['near'],
  );
  assert.deepEqual(
    gpu.pageIds.map((id) => packed.pageUrls[id]),
    ['near'],
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('clustered blend classification remains explicit if material transparency was disabled', () => {
  const fixture = blendFixture(new THREE.MeshBasicMaterial());
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(collected.allPages[0].transparent, true);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('transparent source materials on legacy exact pages still use the forward pass', () => {
  const fixture = blendFixture();
  fixture.metadata.primitives[0].pass = 'exact-clusters';
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(collected.allPages[0].transparent, true);
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('shared blend and runtime transmission keep their full source fallback', () => {
  for (const pass of ['shared-blend', 'clustered-blend']) {
    const material =
      pass === 'clustered-blend'
        ? new THREE.MeshPhysicalMaterial({ transmission: 1 })
        : new THREE.MeshBasicMaterial({ transparent: true });
    const fixture = blendFixture(material);
    fixture.metadata.primitives[0].pass = pass;
    const collected = collectClusterPages(
      fixture.source,
      fixture.metadata,
      fixture.indices,
      fixture.associations,
    );
    assert.equal(collected.allPages.length, 0);
    assert.equal(collected.roots.length, 0);
    assert.equal(collected.blendCopies.length, 1);
    assert.equal(collected.blendCopies[0].geometry, fixture.geometry);
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
