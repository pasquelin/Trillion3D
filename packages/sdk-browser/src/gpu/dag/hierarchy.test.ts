// A primitive without a manifest receives `flatHierarchy`: its nodes must carry the replacement
// ceiling and sphere a manifest would, and certify nothing they cannot bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flatHierarchy } from './hierarchy.ts';

/** A page on the x axis, replaced by a band twice its radius. */
const page = (i: number, parentError: number | null) => ({
  min: [i - 1, -1, -1],
  max: [i + 1, 1, 1],
  sphere: [i, 0, 0, 1],
  lodError: 0.01,
  parentError,
  parentSphere: [i, 0, 0, 2],
});

/** Ceiling `[10]` and sphere `[6..9]` of node `n`. */
function replacement(tree: ReturnType<typeof flatHierarchy>, n: number) {
  const base = n * tree.stride;
  return {
    ceil: tree.nodes[base + 10],
    sphere: Array.from(tree.nodes.subarray(base + 6, base + 10)),
  };
}

test('the ceiling is the largest replacement error, the sphere encloses every band', () => {
  // Forty pages: two leaves under one root, so the ceiling rolls up a level.
  const pages = Array.from({ length: 40 }, (_, i) => page(i, 0.02 + i * 0.001));
  const tree = flatHierarchy(pages);
  const root = replacement(tree, 0);
  assert.equal(root.ceil, 0.02 + 39 * 0.001);
  const [cx, cy, cz, r] = root.sphere;
  for (const {
    parentSphere: [x, y, z, rayon],
  } of pages)
    assert.ok(Math.hypot(x - cx, y - cy, z - cz) + rayon <= r + 1e-9, `band at ${x} outside`);
  // The leaves keep their own maximum, not the root's.
  assert.equal(replacement(tree, 1).ceil, 0.02 + 31 * 0.001);
  assert.ok(tree.bounds, 'packing receives the bounds it would otherwise derive again');
});

test('a subtree the ceiling cannot bound certifies nothing', () => {
  const pages = Array.from({ length: 40 }, (_, i) => page(i, 0.02));
  // A cluster nothing replaces, in the second leaf: that leaf and the root keep -1.
  pages[35].parentError = null;
  let tree = flatHierarchy(pages);
  assert.deepEqual(
    [0, 1, 2].map((n) => replacement(tree, n).ceil),
    [-1, 0.02, -1],
  );
  // A band without a sphere, or a negative replacement error, cannot be enclosed either.
  pages[35] = { ...page(35, 0.02), sphere: undefined as never, parentSphere: null as never };
  tree = flatHierarchy(pages);
  assert.equal(replacement(tree, 2).ceil, -1);
  pages[35] = page(35, -0.5);
  tree = flatHierarchy(pages);
  assert.equal(replacement(tree, 2).ceil, -1);
  assert.equal(replacement(tree, 1).ceil, 0.02);
});
