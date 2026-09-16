// Lot M3a, mathTransformTree.ts : création de la hiérarchie, ajout de nœuds, setters de pose et de
// matrice locale, marquage sale, `matrixAutoUpdate`, agrandissement de capacité et garde `assertNode`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_ALIVE,
  NODE_AUTO_UPDATE,
  NODE_LOCAL_CHANGED,
  NODE_TRS_DIRTY,
  addTransformNode,
  assertNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from './mathTransformTree.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('createTransformTree : arbre vide, capacité demandée, aucun nœud vivant', () => {
  const tree = createTransformTree(8);
  assert.equal(tree.capacity, 8);
  assert.equal(tree.end, 0);
  assert.equal(tree.freeCount, 0);
  assert.equal(tree.parent.length, 8);
  assert.equal(tree.world.length, 8 * 16);
  assert.equal(tree.worldViews.length, 8);
});

test('createTransformTree(0) : capacité plancher à 1, pas de division par zéro à l’agrandissement', () => {
  const tree = createTransformTree(0);
  assert.equal(tree.capacity, 1);
});

test('addTransformNode sans parent : état d’un objet neuf — position nulle, quaternion identité, échelle 1, matrices identité, mise à jour automatique', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  assert.equal(node, 0);
  assert.equal(tree.parent[node], -1);
  assert.deepEqual([...tree.position.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual([...tree.quaternion.subarray(0, 4)], [0, 0, 0, 1]);
  assert.deepEqual([...tree.scale.subarray(0, 3)], [1, 1, 1]);
  assert.deepEqual([...tree.localViews[node]], IDENTITY);
  assert.deepEqual([...tree.worldViews[node]], IDENTITY);
  const flags = tree.flags[node];
  assert.ok(flags & NODE_ALIVE);
  assert.ok(flags & NODE_AUTO_UPDATE);
  assert.ok(flags & NODE_TRS_DIRTY);
  assert.ok(flags & NODE_LOCAL_CHANGED);
});

test('addTransformNode(parent) : le nœud porte l’indice du parent, un parent inconnu lève', () => {
  const tree = createTransformTree(4);
  const parent = addTransformNode(tree);
  const enfant = addTransformNode(tree, parent);
  assert.equal(tree.parent[enfant], parent);
  assert.throws(() => addTransformNode(tree, 99), /nœud 99 absent/);
});

test('assertNode : lève pour un indice hors bornes ou négatif, ne lève pas pour un nœud vivant', () => {
  const tree = createTransformTree(2);
  const node = addTransformNode(tree);
  assert.doesNotThrow(() => assertNode(tree, node));
  assert.throws(() => assertNode(tree, -1), /nœud -1 absent/);
  assert.throws(() => assertNode(tree, 5), /nœud 5 absent/);
});

test('setNodePosition/Quaternion/Scale : écrivent les composantes et marquent NODE_TRS_DIRTY', () => {
  const tree = createTransformTree(2);
  const node = addTransformNode(tree);
  tree.flags[node] &= ~NODE_TRS_DIRTY; // état propre imposé pour observer la remarque
  setNodePosition(tree, node, 1, 2, 3);
  assert.deepEqual([...tree.position.subarray(node * 3, node * 3 + 3)], [1, 2, 3]);
  assert.ok(tree.flags[node] & NODE_TRS_DIRTY);

  tree.flags[node] &= ~NODE_TRS_DIRTY;
  setNodeQuaternion(tree, node, 0, 1, 0, 0);
  assert.deepEqual([...tree.quaternion.subarray(node * 4, node * 4 + 4)], [0, 1, 0, 0]);
  assert.ok(tree.flags[node] & NODE_TRS_DIRTY);

  tree.flags[node] &= ~NODE_TRS_DIRTY;
  setNodeScale(tree, node, 2, 3, 4);
  assert.deepEqual([...tree.scale.subarray(node * 3, node * 3 + 3)], [2, 3, 4]);
  assert.ok(tree.flags[node] & NODE_TRS_DIRTY);
});

test('setNodeLocalMatrix : copie les seize valeurs et marque NODE_LOCAL_CHANGED et NODE_TRS_DIRTY', () => {
  const tree = createTransformTree(2);
  const node = addTransformNode(tree);
  tree.flags[node] = NODE_ALIVE; // état propre
  const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 6, 7, 1];
  setNodeLocalMatrix(tree, node, m);
  assert.deepEqual([...tree.localViews[node]], m);
  assert.ok(tree.flags[node] & NODE_LOCAL_CHANGED);
  assert.ok(tree.flags[node] & NODE_TRS_DIRTY);
});

test('setNodeAutoUpdate : bascule NODE_AUTO_UPDATE sans toucher aux autres drapeaux', () => {
  const tree = createTransformTree(2);
  const node = addTransformNode(tree);
  const autresAvant = tree.flags[node] & ~NODE_AUTO_UPDATE;
  setNodeAutoUpdate(tree, node, false);
  assert.equal(tree.flags[node] & NODE_AUTO_UPDATE, 0);
  assert.equal(tree.flags[node] & ~NODE_AUTO_UPDATE, autresAvant);
  setNodeAutoUpdate(tree, node, true);
  assert.ok(tree.flags[node] & NODE_AUTO_UPDATE);
});

test('agrandissement de capacité : le contenu déjà écrit survit, la capacité double', () => {
  const tree = createTransformTree(1);
  const premier = addTransformNode(tree);
  setNodePosition(tree, premier, 9, 8, 7);
  assert.equal(tree.capacity, 1);
  const second = addTransformNode(tree); // dépasse la capacité initiale : reserve(2)
  assert.equal(tree.capacity, 2);
  assert.deepEqual([...tree.position.subarray(premier * 3, premier * 3 + 3)], [9, 8, 7]);
  assert.notEqual(second, premier);
  assert.equal(tree.end, 2);
});
