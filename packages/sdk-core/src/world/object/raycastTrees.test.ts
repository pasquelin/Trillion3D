import test from 'node:test';
import assert from 'node:assert/strict';
import { object, raycast } from './index.ts';
import { geometry } from '../geometry/index.ts';
import { Ray } from '../math/volumes.ts';
import { Vector3 } from '../math/vector3.ts';
import { heldTree, raycastTreeBudget, RAYCAST_TREE_BUDGET } from './raycastTrees.ts';

const down = new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0));

test('dispose drops the raycast tree of its geometry', () => {
  const box = object.mesh(geometry.box(2, 2, 2));
  raycast(box, down);
  const held = raycastTreeBudget.held;
  assert.ok(heldTree(box.geometry), 'the tree is kept after a raycast');
  box.geometry.dispose();
  assert.equal(heldTree(box.geometry), null);
  assert.ok(raycastTreeBudget.held < held, 'its bytes leave the cache');
});

test('past the budget, the tree cast at least recently is evicted', () => {
  const [a, b, c] = [1, 2, 3].map((s) => object.mesh(geometry.box(s, s, s)));
  raycast(a, down);
  const one = raycastTreeBudget.held;
  raycastTreeBudget.bytes = one * 2; // room for two box trees, whatever else was held
  try {
    raycast(b, down);
    raycast(a, down); // a is now the most recent, b the oldest
    raycast(c, down);
    assert.equal(heldTree(b.geometry), null, 'the oldest tree left');
    assert.ok(heldTree(a.geometry) && heldTree(c.geometry));
    assert.ok(raycastTreeBudget.held <= raycastTreeBudget.bytes);
    assert.equal(raycast(b, down).length, 1, 'an evicted shape is still hit, its tree rebuilt');
  } finally {
    raycastTreeBudget.bytes = RAYCAST_TREE_BUDGET;
  }
});

test('a shape changed since its tree was built is not answered by the old tree', () => {
  const box = object.mesh(geometry.box(2, 2, 2));
  raycast(box, down);
  box.geometry.translate(0, 5, 0);
  assert.equal(heldTree(box.geometry), null);
  assert.ok(Math.abs(raycast(box, down)[0].point.y - 6) < 1e-9);
});
