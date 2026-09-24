import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages, type PageRec } from '../selection/selection.ts';
import { dagFixture, wideCamera } from '../selection/dag.fixture.ts';
import { dagCulling } from '../selection/helpers.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

const ASK = {
  pixelError: 0,
  viewport: [1280, 720] as [number, number],
  holdResident: true,
};

/** Test DAG with its culling hierarchy, hence with the hierarchical cut. */
function hierarchicalFixture() {
  const fixture = dagFixture();
  fixture.metadata.primitives[0].culling = dagCulling();
  return fixture;
}

function rootsOf(fixture: ReturnType<typeof dagFixture>) {
  return collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  ).roots;
}

/** Clusters requested and shown by a cut, flat then hierarchical, under the same camera. */
function bothCuts(cam: THREE.PerspectiveCamera) {
  const cut = (fixture: ReturnType<typeof dagFixture>) => {
    const result = selectVisiblePages(rootsOf(fixture), cameraMoteur(cam), ASK);
    fixture.geometry.dispose();
    return {
      shown: result.shown.map((page) => page.url).sort(),
      wanted: result.wanted.map((page) => page.url).sort(),
    };
  };
  return { flat: cut(dagFixture()), hierarchical: cut(hierarchicalFixture()) };
}

function lookingAt(from: [number, number, number], at: [number, number, number]) {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(...from);
  cam.lookAt(...at);
  cam.updateMatrixWorld();
  return cam;
}

for (const [name, cam] of [
  ['all visible', wideCamera()],
  ['all outside the frustum', lookingAt([0, 0, -100], [0, 0, -1000])],
  ['mixed', lookingAt([1, 0, 5], [0, 0, 0])],
] as const)
  test(`the hierarchical cut matches the flat cut, camera ${name}`, () => {
    const { flat, hierarchical } = bothCuts(cam);
    assert.deepEqual(hierarchical.shown, flat.shown, 'same shown clusters');
    assert.deepEqual(hierarchical.wanted, flat.wanted, 'same requested clusters');
  });

test('a node accepted as a block only shows clusters under the threshold (monotonicity)', () => {
  const fixture = hierarchicalFixture();
  const roots = rootsOf(fixture);
  for (const pixelError of [0, 0.01, 0.02, 0.1, 0.2, 1]) {
    const result = selectVisiblePages(roots, cameraMoteur(wideCamera()), { ...ASK, pixelError });
    for (const cluster of result.shown)
      if (cluster.lodError !== undefined)
        assert.ok(
          cluster.lodError <= pixelError,
          `${cluster.url}: error ${cluster.lodError} accepted above threshold ${pixelError}`,
        );
  }
  fixture.geometry.dispose();
});

test('a node with invalid bounds (NaN) is rejected at prepare', () => {
  const fixture = hierarchicalFixture();
  const page = fixture.metadata.primitives[0].pages[4];
  page.parentError = 0.1;
  page.parentSphere = [NaN, 0, 0, 1];
  assert.throws(() => rootsOf(fixture), /Invalid cluster parameters/);
  fixture.geometry.dispose();
});

test('nodesTested is a non-negative integer after a hierarchical cut frame', () => {
  const fixture = hierarchicalFixture();
  const roots = rootsOf(fixture);
  for (let image = 0; image < 3; image++) {
    const { nodesTested } = selectVisiblePages(roots, cameraMoteur(wideCamera()), { ...ASK });
    assert.ok(Number.isInteger(nodesTested) && nodesTested >= 0, `nodesTested = ${nodesTested}`);
  }
  fixture.geometry.dispose();
});

test('the hierarchical cut reuses its result and arrays from one frame to the next', () => {
  const fixture = hierarchicalFixture();
  const roots = rootsOf(fixture);
  const cam = wideCamera();
  const shown: PageRec[] = [];
  const wanted: PageRec[] = [];
  const result = {
    shown,
    wanted,
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    nodesTested: 0,
    lodLevel: 0,
    complete: true,
    pixelError: 0,
    requiredSlots: null,
    budgetSettled: true,
  };
  const ask = { ...ASK, result, wanted };
  const first = selectVisiblePages(roots, cameraMoteur(cam), ask, shown);
  const second = selectVisiblePages(roots, cameraMoteur(cam), { ...ask }, shown);
  assert.equal(second, first, 'result object reused');
  assert.equal(second.shown, shown, 'shown array reused');
  assert.equal(second.wanted, wanted, 'wanted array reused');
  fixture.geometry.dispose();
});
