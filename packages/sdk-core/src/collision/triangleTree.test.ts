import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriangleTree } from './triangleTree.ts';

test('triangle tree reports the bytes it owns and maps reordered triangles back to source ranks', () => {
  const source = Array.from({ length: 90 }, (_, i) => Math.sin(i) * 20),
    copy = [...source],
    ranks = new Uint32Array(10);
  const tree = buildTriangleTree(source, ranks);
  assert.deepEqual(source, copy);
  assert.equal(tree.triangleCount, 10);
  // Every array the tree holds is counted, and nothing else.
  const held = Object.values(tree).filter(ArrayBuffer.isView);
  assert.equal(
    tree.bytes,
    held.reduce((sum, array) => sum + array.byteLength, 0),
  );
  assert.deepEqual(
    [...ranks].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  for (let t = 0; t < 10; t++)
    assert.deepEqual(
      tree.triangles.slice(t * 9, t * 9 + 9),
      new Float32Array(source.slice(ranks[t] * 9, ranks[t] * 9 + 9)),
    );
});

test('tree root bounds enclose the actual positive and negative coordinate ranges tightly', () => {
  for (const sign of [-1, 1]) {
    const triangle = [3, 4, 5, 10, 6, 9, 8, 20, 7].map((value) => value * sign);
    const tree = buildTriangleTree(Array.from({ length: 6 }, () => triangle).flat());
    assert.deepEqual(
      [...tree.bounds.slice(0, 6)],
      sign > 0 ? [3, 4, 5, 10, 20, 9] : [-10, -20, -9, -3, -4, -5],
    );
  }
});

test('each leaf bounds only its assigned triangles, even next to a distant cluster', () => {
  const triangle = [3, 4, 5, 10, 6, 9, 8, 20, 7];
  const tree = buildTriangleTree(
    Array.from({ length: 8 }, (_, i) => triangle.map((value) => value * (i < 4 ? -1 : 1))).flat(),
  );
  for (let node = 0; node < tree.counts.length; node++) {
    if (!tree.counts[node]) continue;
    const signs = new Set(
      Array.from({ length: tree.counts[node] }, (_, i) =>
        Math.sign(tree.triangles[9 * (tree.links[node] + i)]),
      ),
    );
    const expected =
      signs.size === 2
        ? [-10, -20, -9, 10, 20, 9]
        : signs.has(1)
          ? [3, 4, 5, 10, 20, 9]
          : [-10, -20, -9, -3, -4, -5];
    assert.deepEqual([...tree.bounds.slice(node * 6, node * 6 + 6)], expected);
  }
});

test('a single negative leaf and the final negative leaf retain negative upper bounds', () => {
  const triangle = [-3, -4, -5, -10, -6, -9, -8, -20, -7];
  for (const count of [1, 6]) {
    const tree = buildTriangleTree(Array.from({ length: count }, () => triangle).flat());
    for (let node = 0; node < tree.counts.length; node++)
      assert.deepEqual([...tree.bounds.slice(node * 6, node * 6 + 6)], [-10, -20, -9, -3, -4, -5]);
  }
});
