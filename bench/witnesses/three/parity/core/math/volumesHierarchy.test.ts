// Batch M2, parent/child cases: a real host-library Object3D chain (depth ≥ 3, negative scale on
// one axis, parent rotation on non-uniform scale) whose `matrixWorld` we take, to check that our
// volumes match the host library's transformed boxes, bounding spheres and box-in-frustum tests
// bit-exact. The host library is used here only to compare, never in a `math*.ts` file.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  boxTransform,
  frustumExcludesBox,
  frustumPlanesFromMatrix,
  sphereFromBounds,
} from '../../../../../../packages/sdk-core/src/index.ts';
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts';
import { aPlat, boite3 } from '../../../../../oracles/core/volumes.ts';

/** Chain root → rotated parent with non-uniform scale → child with negative scale → grandchild. */
function chainOfFour() {
  const rootNode = new THREE.Object3D();
  rootNode.position.set(5, -3, 2);
  rootNode.rotation.set(0.2, 0.1, -0.3);
  rootNode.scale.set(1.5, 1.5, 1.5);

  const parent = new THREE.Object3D();
  parent.position.set(-2, 4, 1);
  parent.rotation.set(0.9, -1.2, 0.4); // parent rotation on a non-uniform scale
  parent.scale.set(3, 0.25, 1.7);
  rootNode.add(parent);

  const child = new THREE.Object3D();
  child.position.set(1, 1, -1);
  child.rotation.set(-0.5, 0.3, 0.6);
  child.scale.set(-1, 1, 1); // negative scale on a single axis
  parent.add(child);

  const grandchild = new THREE.Object3D();
  grandchild.position.set(0.3, -0.6, 0.9);
  grandchild.scale.set(2, -0.5, -3); // negative scale on three axes
  child.add(grandchild);

  rootNode.updateMatrixWorld(true);
  return { rootNode, parent, child, grandchild };
}

const localBoxes = [
  [-1, -2, -3, 4, 5, 6],
  [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5],
  [0, 0, 0, 0, 0, 0], // a point
];

test('boxTransform under each matrixWorld of a depth ≥ 3 chain equals the host-library transformed box bit-exact', () => {
  const { parent, child, grandchild } = chainOfFour();
  for (const treeNode of [parent, child, grandchild]) {
    assert.ok(treeNode.matrixWorld.elements.some((v) => v !== 0));
    for (const b of localBoxes) {
      const actual = new Float64Array(6);
      boxTransform(actual, 0, b, 0, treeNode.matrixWorld.elements);
      assertBits(actual, aPlat(boite3(b).applyMatrix4(treeNode.matrixWorld)));
    }
  }
});

test('sphereFromBounds after a grandchild matrixWorld equals getBoundingSphere bit-exact', () => {
  const { grandchild } = chainOfFour();
  for (const b of localBoxes) {
    const expected = boite3(b)
      .applyMatrix4(grandchild.matrixWorld)
      .getBoundingSphere(new THREE.Sphere());
    const world = new Float64Array(6);
    boxTransform(world, 0, b, 0, grandchild.matrixWorld.elements);
    const actual = new Float64Array(4);
    sphereFromBounds(actual, 0, world[0], world[1], world[2], world[3], world[4], world[5]);
    assertBits(
      actual,
      Float64Array.of(expected.center.x, expected.center.y, expected.center.z, expected.radius),
    );
  }
});

test('frustumExcludesBox for a camera posed in the hierarchy equals the host-library negated box-in-frustum test on descendant world boxes', () => {
  const { rootNode, parent, child, grandchild } = chainOfFour();
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.3, 300);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  camera.position.set(2, 1, 6);
  camera.rotation.set(0.1, -0.4, 0);
  camera.updateProjectionMatrix();
  child.add(camera); // the camera is itself a child of the chain
  rootNode.updateMatrixWorld(true);

  const vp = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(vp, THREE.WebGPUCoordinateSystem);
  const planes = new Float64Array(24);
  frustumPlanesFromMatrix(planes, vp.elements);

  for (const treeNode of [parent, child, grandchild]) {
    for (const b of localBoxes) {
      const world = boite3(b).applyMatrix4(treeNode.matrixWorld);
      const expectedExcluded = !frustum.intersectsBox(world);
      const actual = frustumExcludesBox(
        planes,
        world.min.x,
        world.min.y,
        world.min.z,
        world.max.x,
        world.max.y,
        world.max.z,
      );
      assert.equal(actual, expectedExcluded, `node ${treeNode.id}, box ${b.join(',')}`);
    }
  }
});
