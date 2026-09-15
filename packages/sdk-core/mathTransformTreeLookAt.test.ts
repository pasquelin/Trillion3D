// Lot M3a, mathTransformTreeLookAt.ts : `lookAt` pour un objet et pour une caméra, cas limite de la
// visée colinéaire au haut, retrait de la rotation du parent, et parent d'échelle nulle (aucune
// division par zéro qui ferait lever).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransformNode,
  createTransformTree,
  setNodeQuaternion,
  setNodeScale,
} from './mathTransformTree.ts';
import { lookAtNode } from './mathTransformTreeLookAt.ts';
import { nodeWorldDirection } from './mathTransformTreeRead.ts';
import { updateNodeMatrixWorld } from './mathTransformTreeUpdate.ts';

const HAUT = [0, 1, 0];
const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const direction = (tree: ReturnType<typeof createTransformTree>, node: number, viewer: boolean) => {
  updateNodeMatrixWorld(tree, node, true);
  const out = new Float64Array(3);
  nodeWorldDirection(out, tree, node, viewer);
  return [...out];
};

test('lookAt d’une caméra : la direction de vue (-z) pointe vers la cible', () => {
  const tree = createTransformTree(4);
  const camera = addTransformNode(tree);
  updateNodeMatrixWorld(tree, camera, true); // pose la caméra à l’origine d’abord
  lookAtNode(tree, camera, 0, 0, -10, HAUT, true);
  const d = direction(tree, camera, true);
  assert.ok(proche(d[0], 0) && proche(d[1], 0) && proche(d[2], -1));
});

test('lookAt d’un objet : la direction présentée (+z) pointe vers la cible, à l’opposé de la caméra pour la même visée', () => {
  const tree = createTransformTree(4);
  const objet = addTransformNode(tree);
  lookAtNode(tree, objet, 0, 0, -10, HAUT, false);
  const d = direction(tree, objet, false);
  assert.ok(proche(d[0], 0) && proche(d[1], 0) && proche(d[2], -1));
});

test('lookAt : l’œil déjà sur la cible ne lève pas, l’axe z retombe sur (0,0,1)', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  assert.doesNotThrow(() => lookAtNode(tree, node, 0, 0, 0, HAUT, true));
});

test('lookAt : visée colinéaire au haut ne lève pas et rend un axe de vue non nul', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  updateNodeMatrixWorld(tree, node, true);
  lookAtNode(tree, node, 0, -10, 0, HAUT, true); // cible droit sous le haut (0,1,0)
  const d = direction(tree, node, true);
  const norme = Math.hypot(d[0], d[1], d[2]);
  assert.ok(proche(norme, 1), `direction non normalisée : ${d}`);
});

test('lookAt sous un parent tourné : la rotation locale retire celle du parent', () => {
  const tree = createTransformTree(4);
  const parent = addTransformNode(tree);
  setNodeQuaternion(tree, parent, 0, 1, 0, 0); // demi-tour du parent autour de y
  const enfant = addTransformNode(tree, parent);
  lookAtNode(tree, enfant, 0, 0, -10, HAUT, true);
  const d = direction(tree, enfant, true);
  // Malgré le demi-tour du parent, la direction monde de la caméra vise toujours -z.
  assert.ok(proche(d[0], 0) && proche(d[1], 0) && proche(d[2], -1), `direction : ${d}`);
});

test('lookAt sous un parent d’échelle nulle : ne lève pas (extractRotationRows divise par une norme de colonne, pas par l’échelle)', () => {
  const tree = createTransformTree(4);
  const parent = addTransformNode(tree);
  setNodeScale(tree, parent, 0, 1, 1);
  const enfant = addTransformNode(tree, parent);
  updateNodeMatrixWorld(tree, parent, true);
  assert.doesNotThrow(() => lookAtNode(tree, enfant, 1, 1, 1, HAUT, false));
});
