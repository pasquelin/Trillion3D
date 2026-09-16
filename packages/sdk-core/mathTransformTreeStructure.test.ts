// Lot M3a, mathTransformTreeStructure.ts : ordre de mise à jour (contigu et par profondeur),
// parcours de sous-arbre, retrait (avec réemploi des indices) et reparentage (dont le cycle refusé).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransformNode,
  createTransformTree,
  NODE_ALIVE,
  NODE_LOCAL_CHANGED,
} from './mathTransformTree.ts';
import {
  ensureOrder,
  nextStamp,
  removeTransformNode,
  reparentTransformNode,
  visitSubtree,
} from './mathTransformTreeStructure.ts';

test('ensureOrder : parents d’indice inférieur aux enfants, ordre contigu (chemin monotone)', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  const petitEnfant = addTransformNode(tree, enfant);
  ensureOrder(tree);
  assert.deepEqual([...tree.order.subarray(0, 3)], [racine, enfant, petitEnfant]);
  assert.equal(tree.orderAt[racine], 0);
  assert.equal(tree.orderAt[enfant], 1);
  assert.equal(tree.orderAt[petitEnfant], 2);
});

test('ensureOrder : après un reparentage qui inverse les indices, chaque parent précède ses enfants', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree); // b après a, mais deviendra son enfant
  reparentTransformNode(tree, a, b); // a (indice inférieur) sous b (indice supérieur) : non monotone
  ensureOrder(tree);
  assert.ok(tree.orderAt[b] < tree.orderAt[a], 'b (parent) doit précéder a (enfant) dans l’ordre');
});

test('nextStamp : une marque neuve à chaque appel, jamais nulle', () => {
  const tree = createTransformTree(1);
  const m1 = nextStamp(tree);
  const m2 = nextStamp(tree);
  assert.notEqual(m1, m2);
  assert.notEqual(m1, 0);
  assert.notEqual(m2, 0);
});

test('visitSubtree : visite le nœud puis ses descendants parents d’abord, jamais ses frères', () => {
  const tree = createTransformTree(8);
  const racine = addTransformNode(tree);
  const frere = addTransformNode(tree, racine);
  const cible = addTransformNode(tree, racine);
  const petitEnfant = addTransformNode(tree, cible);
  const visites: number[] = [];
  visitSubtree(tree, cible, (_t, n) => visites.push(n));
  assert.deepEqual(visites, [cible, petitEnfant]);
  assert.ok(!visites.includes(frere));
  assert.ok(!visites.includes(racine));
});

test('removeTransformNode : retire le nœud et ses descendants, un frère reste vivant', () => {
  const tree = createTransformTree(8);
  const racine = addTransformNode(tree);
  const branche = addTransformNode(tree, racine);
  const feuille = addTransformNode(tree, branche);
  const frere = addTransformNode(tree, racine);
  removeTransformNode(tree, branche);
  assert.equal(tree.flags[branche] & NODE_ALIVE, 0);
  assert.equal(tree.flags[feuille] & NODE_ALIVE, 0);
  assert.ok(tree.flags[frere] & NODE_ALIVE);
  assert.equal(tree.flags[racine] & NODE_ALIVE, NODE_ALIVE);
});

test('removeTransformNode : les indices libérés sont réutilisés, en pile, par le prochain ajout', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree);
  removeTransformNode(tree, b);
  removeTransformNode(tree, a);
  const reutiliseA = addTransformNode(tree); // dernier libéré, premier repris (pile)
  assert.equal(reutiliseA, a);
  const reutiliseB = addTransformNode(tree);
  assert.equal(reutiliseB, b);
});

test('reparentTransformNode : change le parent et marque NODE_LOCAL_CHANGED', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree);
  const enfant = addTransformNode(tree, a);
  tree.flags[enfant] &= ~NODE_LOCAL_CHANGED;
  reparentTransformNode(tree, enfant, b);
  assert.equal(tree.parent[enfant], b);
  assert.ok(tree.flags[enfant] & NODE_LOCAL_CHANGED);
});

test('reparentTransformNode : aucun effet si le parent est déjà celui-là (pas de remarque)', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const enfant = addTransformNode(tree, a);
  tree.flags[enfant] &= ~NODE_LOCAL_CHANGED;
  reparentTransformNode(tree, enfant, a);
  assert.equal(
    tree.flags[enfant] & NODE_LOCAL_CHANGED,
    0,
    'aucune remarque pour un parent inchangé',
  );
});

test('reparentTransformNode : lève un cycle si le nouveau parent est le nœud lui-même ou l’un de ses descendants', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  const petitEnfant = addTransformNode(tree, enfant);
  assert.throws(() => reparentTransformNode(tree, racine, racine), /TRANSFORM_CYCLE|cycle/);
  assert.throws(() => reparentTransformNode(tree, racine, petitEnfant), /TRANSFORM_CYCLE|cycle/);
});
