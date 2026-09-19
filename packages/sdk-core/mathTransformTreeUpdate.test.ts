// Batch M3a, mathTransformTreeUpdate.ts: `updateMatrixWorld(force)` (clean node not recalculated,
// dirty parent that propagates, `matrixAutoUpdate` false that freezes a node until `force` reaches
// it) and `updateWorldMatrix(updateParents, updateChildren)`. Allocation: views are the same objects
// before and after a hot update.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodePosition,
} from './mathTransformTree.ts';
import { reparentTransformNode } from './mathTransformTreeStructure.ts';
import { updateNodeMatrixWorld, updateNodeWorldMatrix } from './mathTransformTreeUpdate.ts';

test('updateNodeMatrixWorld: composes and copies a root local matrix, version goes to 1', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  setNodePosition(tree, racine, 3, -4, 5);
  updateNodeMatrixWorld(tree, racine);
  assert.deepEqual(
    [tree.worldViews[racine][12], tree.worldViews[racine][13], tree.worldViews[racine][14]],
    [3, -4, 5],
  );
  assert.equal(tree.version[racine], 1);
});

test('a clean node is not recalculated: version no longer moves on the second call with nothing changed', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  updateNodeMatrixWorld(tree, racine);
  const version = tree.version[racine];
  updateNodeMatrixWorld(tree, racine);
  assert.equal(tree.version[racine], version, 'nothing changed: no recalculation');
});

test('a dirty parent propagates to descendants even if they are not marked themselves', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  setNodePosition(tree, enfant, 1, 0, 0);
  updateNodeMatrixWorld(tree, racine);
  const versionEnfantAvant = tree.version[enfant];
  setNodePosition(tree, racine, 10, 0, 0); // only the root is marked dirty
  updateNodeMatrixWorld(tree, racine);
  assert.notEqual(tree.version[enfant], versionEnfantAvant, 'the child must be recalculated');
  assert.equal(tree.worldViews[enfant][12], 11, 'child world = parent world (10) + local (1)');
});

test('matrixAutoUpdate false: without force, a never-marked node keeps its starting world matrix', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  setNodeAutoUpdate(tree, racine, false);
  setNodePosition(tree, racine, 7, 7, 7); // pose written, but nothing reaches it without force
  updateNodeMatrixWorld(tree, racine, false);
  assert.equal(tree.version[racine], 0, 'never reached: no calculation');
  assert.deepEqual([tree.worldViews[racine][12], tree.worldViews[racine][13]], [0, 0]);
});

test('matrixAutoUpdate false: `force=true` reaches the node a first time', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  setNodeAutoUpdate(tree, racine, false);
  setNodePosition(tree, racine, 7, 7, 7);
  updateNodeMatrixWorld(tree, racine, true);
  assert.equal(tree.version[racine], 1);
});

test('force=true on an already clean hierarchy still recalculates nothing (recalculation gated by a real change)', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  updateNodeMatrixWorld(tree, racine, true);
  const [v1, v2] = [tree.version[racine], tree.version[enfant]];
  updateNodeMatrixWorld(tree, racine, true);
  assert.equal(tree.version[racine], v1);
  assert.equal(tree.version[enfant], v2);
});

test('updateWorldMatrix(true, false): updates stale ancestors up to the node, not its children', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  const petitEnfant = addTransformNode(tree, enfant);
  updateNodeMatrixWorld(tree, racine, true);
  setNodePosition(tree, racine, 2, 0, 0); // stales root, child and grandchild
  updateNodeWorldMatrix(tree, enfant, true, false);
  assert.equal(tree.worldViews[racine][12], 2, 'the ancestor was caught up');
  assert.equal(tree.version[petitEnfant], 1, 'the grandchild, out of request, keeps its version');
});

test('updateWorldMatrix(false, true): updates the node and its subtree', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  updateNodeMatrixWorld(tree, racine, true);
  setNodePosition(tree, racine, 5, 0, 0);
  updateNodeWorldMatrix(tree, racine, false, true);
  assert.equal(tree.worldViews[enfant][12], 5, 'the child followed the updated subtree');
});

test('a reparent marks the node dirty: its world matrix follows its new parent at the next update', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree);
  setNodePosition(tree, b, 100, 0, 0);
  const enfant = addTransformNode(tree, a);
  updateNodeMatrixWorld(tree, a, true);
  updateNodeMatrixWorld(tree, b, true);
  reparentTransformNode(tree, enfant, b);
  updateNodeMatrixWorld(tree, b, true);
  assert.equal(tree.worldViews[enfant][12], 100, 'the child now follows b, not a');
});

test('allocation: world-matrix views stay the same objects from one update to the next', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const vueAvant = tree.worldViews[racine];
  const localAvant = tree.localViews[racine];
  updateNodeMatrixWorld(tree, racine, true);
  setNodePosition(tree, racine, 1, 2, 3);
  updateNodeMatrixWorld(tree, racine, true);
  assert.equal(tree.worldViews[racine], vueAvant);
  assert.equal(tree.localViews[racine], localAvant);
});
