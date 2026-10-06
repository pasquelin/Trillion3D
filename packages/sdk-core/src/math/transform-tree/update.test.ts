// Batch M3a, update.ts: the world update with `force` (clean node not recalculated,
// dirty parent that propagates, automatic update off that freezes a node until `force` reaches
// it) and the update with `updateParents` and `updateChildren`. Allocation: views are the same objects
// before and after a hot update.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodePosition,
} from './transformTree.ts';
import { reparentTransformNode } from './structure.ts';
import { updateNodeMatrixWorld, updateNodeWorldMatrix } from './update.ts';

test('updateNodeMatrixWorld: composes and copies a root local matrix, version goes to 1', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  setNodePosition(tree, root, 3, -4, 5);
  updateNodeMatrixWorld(tree, root);
  assert.deepEqual(
    [tree.worldViews[root][12], tree.worldViews[root][13], tree.worldViews[root][14]],
    [3, -4, 5],
  );
  assert.equal(tree.version[root], 1);
});

test('a clean node is not recalculated: version no longer moves on the second call with nothing changed', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  updateNodeMatrixWorld(tree, root);
  const version = tree.version[root];
  updateNodeMatrixWorld(tree, root);
  assert.equal(tree.version[root], version, 'nothing changed: no recalculation');
});

test('a dirty parent propagates to descendants even if they are not marked themselves', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  const child = addTransformNode(tree, root);
  setNodePosition(tree, child, 1, 0, 0);
  updateNodeMatrixWorld(tree, root);
  const versionChildBefore = tree.version[child];
  setNodePosition(tree, root, 10, 0, 0); // only the root is marked dirty
  updateNodeMatrixWorld(tree, root);
  assert.notEqual(tree.version[child], versionChildBefore, 'the child must be recalculated');
  assert.equal(tree.worldViews[child][12], 11, 'child world = parent world (10) + local (1)');
});

test('matrixAutoUpdate false: without force, a never-marked node keeps its starting world matrix', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  setNodeAutoUpdate(tree, root, false);
  setNodePosition(tree, root, 7, 7, 7); // pose written, but nothing reaches it without force
  updateNodeMatrixWorld(tree, root, false);
  assert.equal(tree.version[root], 0, 'never reached: no calculation');
  assert.deepEqual([tree.worldViews[root][12], tree.worldViews[root][13]], [0, 0]);
});

test('matrixAutoUpdate false: `force=true` reaches the node a first time', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  setNodeAutoUpdate(tree, root, false);
  setNodePosition(tree, root, 7, 7, 7);
  updateNodeMatrixWorld(tree, root, true);
  assert.equal(tree.version[root], 1);
});

test('force=true on an already clean hierarchy still recalculates nothing (recalculation gated by a real change)', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  const child = addTransformNode(tree, root);
  updateNodeMatrixWorld(tree, root, true);
  const [v1, v2] = [tree.version[root], tree.version[child]];
  updateNodeMatrixWorld(tree, root, true);
  assert.equal(tree.version[root], v1);
  assert.equal(tree.version[child], v2);
});

test('updateWorldMatrix(true, false): updates stale ancestors up to the node, not its children', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  const child = addTransformNode(tree, root);
  const grandchild = addTransformNode(tree, child);
  updateNodeMatrixWorld(tree, root, true);
  setNodePosition(tree, root, 2, 0, 0); // stales root, child and grandchild
  updateNodeWorldMatrix(tree, child, true, false);
  assert.equal(tree.worldViews[root][12], 2, 'the ancestor was caught up');
  assert.equal(tree.version[grandchild], 1, 'the grandchild, out of request, keeps its version');
});

test('updateWorldMatrix(false, true): updates the node and its subtree', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  const child = addTransformNode(tree, root);
  updateNodeMatrixWorld(tree, root, true);
  setNodePosition(tree, root, 5, 0, 0);
  updateNodeWorldMatrix(tree, root, false, true);
  assert.equal(tree.worldViews[child][12], 5, 'the child followed the updated subtree');
});

test('a reparent marks the node dirty: its world matrix follows its new parent at the next update', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree);
  setNodePosition(tree, b, 100, 0, 0);
  const child = addTransformNode(tree, a);
  updateNodeMatrixWorld(tree, a, true);
  updateNodeMatrixWorld(tree, b, true);
  reparentTransformNode(tree, child, b);
  updateNodeMatrixWorld(tree, b, true);
  assert.equal(tree.worldViews[child][12], 100, 'the child now follows b, not a');
});

test('allocation: world-matrix views stay the same objects from one update to the next', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  const viewBefore = tree.worldViews[root];
  const localBefore = tree.localViews[root];
  updateNodeMatrixWorld(tree, root, true);
  setNodePosition(tree, root, 1, 2, 3);
  updateNodeMatrixWorld(tree, root, true);
  assert.equal(tree.worldViews[root], viewBefore);
  assert.equal(tree.localViews[root], localBefore);
});
