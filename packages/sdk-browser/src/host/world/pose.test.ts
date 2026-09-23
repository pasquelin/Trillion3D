// pose.ts: entry of a host local pose into the engine transform tree. What is proved
// here is what makes a per-frame pass cheap — a number that has not moved is NOT written, so the
// node keeps its flags clean and the world pass leaves its subtree alone — and what makes it
// correct: a node whose host cut recomposition carries the mark the reference calls
// `matrixWorldNeedsUpdate`, without which an update rule starting above would walk past it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  NODE_AUTO_UPDATE,
  addTransformNode,
  createTransformTree,
  updateNodeMatrixWorld,
} from '../../../../sdk-core/src/index.ts';
import { pushHostPose } from './pose.ts';

/** A two-node tree, root then child, and the host nodes they mirror. */
function mirror() {
  const tree = createTransformTree(2);
  addTransformNode(tree);
  addTransformNode(tree, 0);
  const root = new THREE.Group(),
    child = new THREE.Group();
  root.add(child);
  return { tree, root, child };
}

test('a pose no number of which moved is not written a second time', () => {
  const { tree, root } = mirror();
  root.position.set(1, -2, 3);
  root.scale.set(2, 2, 2);
  assert.equal(pushHostPose(tree, 0, root), true, 'the first entry writes the pose');
  updateNodeMatrixWorld(tree, 0);
  assert.equal(pushHostPose(tree, 0, root), false, 'the second entry writes nothing');
  assert.equal(tree.flags[0] & NODE_AUTO_UPDATE, NODE_AUTO_UPDATE);
});

test('each of the ten numbers is compared on its own: one moved is one written', () => {
  const { tree, root } = mirror();
  pushHostPose(tree, 0, root);
  updateNodeMatrixWorld(tree, 0);
  for (const move of [
    () => root.position.setX(4),
    () => root.quaternion.set(0, 0.5, 0, Math.sqrt(0.75)),
    () => root.scale.setZ(-1),
  ]) {
    move();
    assert.equal(pushHostPose(tree, 0, root), true);
    updateNodeMatrixWorld(tree, 0);
    assert.equal(pushHostPose(tree, 0, root), false, 'and nothing more once it is in');
  }
});

test('a node whose host cut recomposition enters by its matrix, and is reached from above', () => {
  const { tree, root, child } = mirror();
  child.matrixAutoUpdate = false;
  child.matrix.set(1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7, 0, 0, 0, 1);
  pushHostPose(tree, 0, root);
  assert.equal(pushHostPose(tree, 1, child), true);
  // The root alone is asked to update: without the `matrixWorldNeedsUpdate` mark, the rule would
  // walk past a child that neither recomposes nor carries a reach flag.
  updateNodeMatrixWorld(tree, 0);
  root.updateMatrixWorld(true);
  assert.deepEqual(Array.from(tree.worldViews[1]), Array.from(child.matrixWorld.elements));
  assert.equal(pushHostPose(tree, 1, child), false, 'an unchanged set matrix writes nothing');
});

test('recomposition cut then restored: the flag follows the host, and the pose comes back', () => {
  const { tree, root } = mirror();
  root.position.set(2, 3, 4);
  pushHostPose(tree, 0, root);
  updateNodeMatrixWorld(tree, 0);
  root.matrixAutoUpdate = false;
  root.matrix.set(1, 0, 0, 9, 0, 1, 0, 9, 0, 0, 1, 9, 0, 0, 0, 1);
  assert.equal(pushHostPose(tree, 0, root), true);
  assert.equal(tree.flags[0] & NODE_AUTO_UPDATE, 0);
  updateNodeMatrixWorld(tree, 0);
  assert.deepEqual(Array.from(tree.worldViews[0]).slice(12, 15), [9, 9, 9]);
  root.matrixAutoUpdate = true;
  assert.equal(pushHostPose(tree, 0, root), true, 'the flag alone is a change');
  updateNodeMatrixWorld(tree, 0);
  assert.deepEqual(Array.from(tree.worldViews[0]).slice(12, 15), [2, 3, 4]);
});

test('the sign of a zero is a change: `-0` and `0` do not compose the same translation', () => {
  const { tree, root } = mirror();
  pushHostPose(tree, 0, root);
  updateNodeMatrixWorld(tree, 0);
  root.position.setX(-0);
  assert.equal(pushHostPose(tree, 0, root), true, 'the sign of the zero entered');
  updateNodeMatrixWorld(tree, 0);
  root.updateMatrixWorld(true);
  assert.ok(Object.is(tree.worldViews[0][12], root.matrixWorld.elements[12]), 'same bits');
});

test('a pose left at NaN is not rewritten on every pass', () => {
  const { tree, root } = mirror();
  root.position.setY(Number.NaN);
  assert.equal(pushHostPose(tree, 0, root), true);
  updateNodeMatrixWorld(tree, 0);
  assert.equal(pushHostPose(tree, 0, root), false, 'NaN compares equal to itself');
});
