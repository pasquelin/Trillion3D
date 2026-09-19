// Batch M3a, mathTransformTreeRead.ts: world reads (position, quaternion, scale, direction),
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
} from './mathTransformTree.ts';
import {
  nodeWorldDirection,
  nodeWorldMirrorsFaces,
  nodeWorldPosition,
  nodeWorldQuaternion,
  nodeWorldScale,
} from './mathTransformTreeRead.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

test('nodeWorldPosition updates a stale ancestor before reading', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  setNodePosition(tree, racine, 10, 0, 0);
  setNodePosition(tree, enfant, 1, 2, 3);
  const out = new Float64Array(3);
  nodeWorldPosition(out, tree, enfant); // no explicit update before the call
  assert.deepEqual([...out], [11, 2, 3]);
});

test('nodeWorldQuaternion and nodeWorldScale decompose the world matrix of a rotated and scaled node', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  setNodeQuaternion(tree, node, 0, 1, 0, 0); // half-turn around y
  setNodeScale(tree, node, 2, 3, 4);
  const q = new Float64Array(4),
    s = new Float64Array(3);
  nodeWorldQuaternion(q, tree, node);
  nodeWorldScale(s, tree, node);
  assert.ok(proche(Math.abs(q[1]), 1) && proche(q[0], 0) && proche(q[2], 0));
  assert.ok(proche(s[0], 2) && proche(s[1], 3) && proche(s[2], 4));
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

test('nodeWorldMirrorsFaces: identity and two-axis mirror do not reverse, one or three axes reverse', () => {
  const tree = createTransformTree(4);
  const identite = addTransformNode(tree);
  const unAxe = addTransformNode(tree);
  setNodeScale(tree, unAxe, -1, 1, 1);
  const troisAxes = addTransformNode(tree);
  setNodeScale(tree, troisAxes, -1, -1, -1);
  const deuxAxes = addTransformNode(tree);
  setNodeScale(tree, deuxAxes, -1, -1, 1);
  for (const n of [identite, unAxe, troisAxes, deuxAxes]) {
    const out = new Float64Array(3);
    nodeWorldPosition(out, tree, n); // force the world-matrix update
  }
  assert.equal(nodeWorldMirrorsFaces(tree, identite), false);
  assert.equal(nodeWorldMirrorsFaces(tree, unAxe), true);
  assert.equal(nodeWorldMirrorsFaces(tree, troisAxes), true);
  assert.equal(nodeWorldMirrorsFaces(tree, deuxAxes), false);
});

test('nodeWorldMirrorsFaces: a zero determinant (zero scale) reverses nothing', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  setNodeScale(tree, node, 0, 1, 1);
  const out = new Float64Array(3);
  nodeWorldPosition(out, tree, node);
  assert.equal(nodeWorldMirrorsFaces(tree, node), false);
});
