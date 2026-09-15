// Lot M3a, mathTransformTreeRead.ts : lectures monde (position, quaternion, échelle, direction),
// mise à jour automatique des ancêtres avant lecture, sens des faces (déterminant négatif), et
// `normalize` sur un vecteur nul.
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
  normalize,
} from './mathTransformTreeRead.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

test('nodeWorldPosition met à jour un ancêtre périmé avant de lire', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  setNodePosition(tree, racine, 10, 0, 0);
  setNodePosition(tree, enfant, 1, 2, 3);
  const out = new Float64Array(3);
  nodeWorldPosition(out, tree, enfant); // aucune mise à jour explicite avant l’appel
  assert.deepEqual([...out], [11, 2, 3]);
});

test('nodeWorldQuaternion et nodeWorldScale décomposent la matrice monde d’un nœud tourné et mis à l’échelle', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  setNodeQuaternion(tree, node, 0, 1, 0, 0); // demi-tour autour de y
  setNodeScale(tree, node, 2, 3, 4);
  const q = new Float64Array(4),
    s = new Float64Array(3);
  nodeWorldQuaternion(q, tree, node);
  nodeWorldScale(s, tree, node);
  assert.ok(proche(Math.abs(q[1]), 1) && proche(q[0], 0) && proche(q[2], 0));
  assert.ok(proche(s[0], 2) && proche(s[1], 3) && proche(s[2], 4));
});

test('nodeWorldDirection : objet présente +z, caméra regarde vers -z, à l’identité', () => {
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

test('nodeWorldDirection : une colonne z nulle dans la matrice monde reste nulle après normalisation', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  setNodeAutoUpdate(tree, node, false); // la matrice locale posée ne doit pas être recomposée
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]; // colonne z nulle
  setNodeLocalMatrix(tree, node, m);
  const out = new Float64Array(3);
  nodeWorldDirection(out, tree, node, false);
  assert.deepEqual([...out], [0, 0, 0]);
});

test('nodeWorldMirrorsFaces : identité et miroir sur deux axes ne renversent pas, un seul ou trois axes renversent', () => {
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
    nodeWorldPosition(out, tree, n); // force la mise à jour de la matrice monde
  }
  assert.equal(nodeWorldMirrorsFaces(tree, identite), false);
  assert.equal(nodeWorldMirrorsFaces(tree, unAxe), true);
  assert.equal(nodeWorldMirrorsFaces(tree, troisAxes), true);
  assert.equal(nodeWorldMirrorsFaces(tree, deuxAxes), false);
});

test('nodeWorldMirrorsFaces : un déterminant nul (échelle nulle) ne renverse rien', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  setNodeScale(tree, node, 0, 1, 1);
  const out = new Float64Array(3);
  nodeWorldPosition(out, tree, node);
  assert.equal(nodeWorldMirrorsFaces(tree, node), false);
});

test('normalize : un vecteur nul reste nul, un vecteur ordinaire devient de longueur 1', () => {
  const nul = new Float64Array([0, 0, 0]);
  normalize(nul);
  assert.deepEqual([...nul], [0, 0, 0]);
  const v = new Float64Array([3, 0, 4]);
  normalize(v);
  assert.ok(proche(Math.hypot(v[0], v[1], v[2]), 1));
  assert.ok(proche(v[0], 0.6) && v[1] === 0 && proche(v[2], 0.8));
});
