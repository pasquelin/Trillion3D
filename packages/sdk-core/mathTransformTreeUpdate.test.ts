// Lot M3a, mathTransformTreeUpdate.ts : `updateMatrixWorld(force)` (nœud propre non recalculé, parent
// sale qui propage, `matrixAutoUpdate` à faux qui gèle un nœud tant que `force` ne l'atteint pas) et
// `updateWorldMatrix(updateParents, updateChildren)`. Allocation : les vues sont les mêmes objets
// avant et après une mise à jour à chaud.
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

test('updateNodeMatrixWorld : compose et copie la matrice locale d’une racine, la version passe à 1', () => {
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

test('un nœud propre n’est pas recalculé : la version ne bouge plus au second appel sans rien changer', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  updateNodeMatrixWorld(tree, racine);
  const version = tree.version[racine];
  updateNodeMatrixWorld(tree, racine);
  assert.equal(tree.version[racine], version, 'rien n’a changé : pas de recalcul');
});

test('un parent sale propage aux descendants même non marqués eux-mêmes', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  setNodePosition(tree, enfant, 1, 0, 0);
  updateNodeMatrixWorld(tree, racine);
  const versionEnfantAvant = tree.version[enfant];
  setNodePosition(tree, racine, 10, 0, 0); // seule la racine est marquée sale
  updateNodeMatrixWorld(tree, racine);
  assert.notEqual(tree.version[enfant], versionEnfantAvant, 'l’enfant doit être recalculé');
  assert.equal(tree.worldViews[enfant][12], 11, 'monde enfant = monde parent (10) + local (1)');
});

test('matrixAutoUpdate à faux : sans force, un nœud jamais marqué garde sa matrice monde de départ', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  setNodeAutoUpdate(tree, racine, false);
  setNodePosition(tree, racine, 7, 7, 7); // pose écrite, mais rien ne l’atteint sans force
  updateNodeMatrixWorld(tree, racine, false);
  assert.equal(tree.version[racine], 0, 'jamais atteint : aucun calcul');
  assert.deepEqual([tree.worldViews[racine][12], tree.worldViews[racine][13]], [0, 0]);
});

test('matrixAutoUpdate à faux : `force=true` atteint le nœud une première fois', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  setNodeAutoUpdate(tree, racine, false);
  setNodePosition(tree, racine, 7, 7, 7);
  updateNodeMatrixWorld(tree, racine, true);
  assert.equal(tree.version[racine], 1);
});

test('force=true sur une hiérarchie déjà propre ne recalcule toujours rien (recalcul conditionné par un vrai changement)', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  updateNodeMatrixWorld(tree, racine, true);
  const [v1, v2] = [tree.version[racine], tree.version[enfant]];
  updateNodeMatrixWorld(tree, racine, true);
  assert.equal(tree.version[racine], v1);
  assert.equal(tree.version[enfant], v2);
});

test('updateWorldMatrix(true, false) : met à jour les ancêtres périmés jusqu’au nœud, pas ses enfants', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  const petitEnfant = addTransformNode(tree, enfant);
  updateNodeMatrixWorld(tree, racine, true);
  setNodePosition(tree, racine, 2, 0, 0); // périme racine, enfant et petitEnfant
  updateNodeWorldMatrix(tree, enfant, true, false);
  assert.equal(tree.worldViews[racine][12], 2, 'l’ancêtre a été rattrapé');
  assert.equal(tree.version[petitEnfant], 1, 'le petit-enfant, hors demande, garde sa version');
});

test('updateWorldMatrix(false, true) : met à jour le nœud et son sous-arbre', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  updateNodeMatrixWorld(tree, racine, true);
  setNodePosition(tree, racine, 5, 0, 0);
  updateNodeWorldMatrix(tree, racine, false, true);
  assert.equal(tree.worldViews[enfant][12], 5, 'l’enfant a suivi le sous-arbre mis à jour');
});

test('un rattachement marque le nœud sale : sa matrice monde suit son nouveau parent à la mise à jour suivante', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree);
  setNodePosition(tree, b, 100, 0, 0);
  const enfant = addTransformNode(tree, a);
  updateNodeMatrixWorld(tree, a, true);
  updateNodeMatrixWorld(tree, b, true);
  reparentTransformNode(tree, enfant, b);
  updateNodeMatrixWorld(tree, b, true);
  assert.equal(tree.worldViews[enfant][12], 100, 'l’enfant suit désormais b, pas a');
});

test('allocation : les vues de matrice monde restent les mêmes objets d’une mise à jour à l’autre', () => {
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
