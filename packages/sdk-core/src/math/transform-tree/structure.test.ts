// Batch M3a, structure.ts: update order (contiguous and by depth),
// subtree traversal, removal (with index reuse) and reparenting (including the rejected cycle).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransformNode,
  createTransformTree,
  NODE_ALIVE,
  NODE_LOCAL_CHANGED,
} from './transformTree.ts';
import {
  ensureOrder,
  nextStamp,
  removeTransformNode,
  reparentTransformNode,
  visitSubtree,
} from './structure.ts';

test('ensureOrder: parents of lower index than children, contiguous order (monotonic path)', () => {
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

test('ensureOrder: after a reparent that inverts the indices, each parent precedes its children', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree); // b after a, but will become its child
  reparentTransformNode(tree, a, b); // a (lower index) under b (higher index): non-monotonic
  ensureOrder(tree);
  assert.ok(tree.orderAt[b] < tree.orderAt[a], 'b (parent) must precede a (child) in the order');
});

test('nextStamp: a fresh stamp on every call, never zero', () => {
  const tree = createTransformTree(1);
  const m1 = nextStamp(tree);
  const m2 = nextStamp(tree);
  assert.notEqual(m1, m2);
  assert.notEqual(m1, 0);
  assert.notEqual(m2, 0);
});

test('visitSubtree: visits the node then its descendants parents first, never its siblings', () => {
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

test('removeTransformNode: removes the node and its descendants, a sibling stays alive', () => {
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

test('removeTransformNode: freed indices are reused, as a stack, by the next add', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree);
  removeTransformNode(tree, b);
  removeTransformNode(tree, a);
  const reutiliseA = addTransformNode(tree); // last freed, first reused (stack)
  assert.equal(reutiliseA, a);
  const reutiliseB = addTransformNode(tree);
  assert.equal(reutiliseB, b);
});

test('reparentTransformNode: changes the parent and marks NODE_LOCAL_CHANGED', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree);
  const enfant = addTransformNode(tree, a);
  tree.flags[enfant] &= ~NODE_LOCAL_CHANGED;
  reparentTransformNode(tree, enfant, b);
  assert.equal(tree.parent[enfant], b);
  assert.ok(tree.flags[enfant] & NODE_LOCAL_CHANGED);
});

test('reparentTransformNode: no effect if the parent is already that one (no remake)', () => {
  const tree = createTransformTree(4);
  const a = addTransformNode(tree);
  const enfant = addTransformNode(tree, a);
  tree.flags[enfant] &= ~NODE_LOCAL_CHANGED;
  reparentTransformNode(tree, enfant, a);
  assert.equal(tree.flags[enfant] & NODE_LOCAL_CHANGED, 0, 'no remake for an unchanged parent');
});

test('reparentTransformNode: throws a cycle if the new parent is the node itself or one of its descendants', () => {
  const tree = createTransformTree(4);
  const racine = addTransformNode(tree);
  const enfant = addTransformNode(tree, racine);
  const petitEnfant = addTransformNode(tree, enfant);
  assert.throws(() => reparentTransformNode(tree, racine, racine), /TRANSFORM_CYCLE|cycle/);
  assert.throws(() => reparentTransformNode(tree, racine, petitEnfant), /TRANSFORM_CYCLE|cycle/);
});
