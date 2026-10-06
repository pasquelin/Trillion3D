// Batch M3a, read.ts: world reads (position, quaternion, scale, direction),
// automatic ancestor update before read and face winding (negative determinant).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './transformTree.ts';
import { nodeWorldDirection, nodeWorldPosition, nodeWorldQuaternion } from './read.ts';

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

test('nodeWorldPosition updates a stale ancestor before reading', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  const child = addTransformNode(tree, root);
  setNodePosition(tree, root, 10, 0, 0);
  setNodePosition(tree, child, 1, 2, 3);
  const out = new Float64Array(3);
  nodeWorldPosition(out, tree, child); // no explicit update before the call
  assert.deepEqual([...out], [11, 2, 3]);
});

test('nodeWorldQuaternion decomposes the world matrix of a rotated and scaled node', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  setNodeQuaternion(tree, node, 0, 1, 0, 0); // half-turn around y
  setNodeScale(tree, node, 2, 3, 4);
  const q = new Float64Array(4);
  nodeWorldQuaternion(q, tree, node);
  assert.ok(near(Math.abs(q[1]), 1) && near(q[0], 0) && near(q[2], 0));
});

test('nodeWorldDirection: object presents +z, camera looks toward -z, at identity', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  const out = new Float64Array(3);
  nodeWorldDirection(out, tree, node, false);
  assert.deepEqual([...out], [0, 0, 1]);
  nodeWorldDirection(out, tree, node, true);
  assert.equal(out[2], -1);
  assert.ok(Object.is(out[0], -0) || out[0] === 0);
  assert.ok(Object.is(out[1], -0) || out[1] === 0);
});

test('nodeWorldDirection: a zero z column in the world matrix stays zero after normalisation', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  setNodeAutoUpdate(tree, node, false); // the set local matrix must not be recomposed
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]; // zero z column
  setNodeLocalMatrix(tree, node, m);
  const out = new Float64Array(3);
  nodeWorldDirection(out, tree, node, false);
  assert.deepEqual([...out], [0, 0, 0]);
});
