import test from 'node:test';
import assert from 'node:assert/strict';
import { meshTriangles, meshCollision, forEachReadNode } from './meshTriangles.ts';
import { buildTriangleTree } from './triangleTree.ts';
import { Mesh } from '../world/object/mesh.ts';
import { Object3D } from '../world/object/object3d.ts';
import { Geometry } from '../world/geometry/geometry.ts';
import { BufferAttribute } from '../world/buffer/attribute.ts';
const shape = () =>
  new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3),
  );

test('raw triangle extraction preserves every corner, and ignores nontriangle or empty meshes', () => {
  const mesh = new Mesh(shape());
  assert.deepEqual([...meshTriangles(mesh, null)!], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  mesh.geometry.setIndex([2, 0, 1]);
  assert.deepEqual([...meshTriangles(mesh, null)!], [7, 8, 9, 1, 2, 3, 4, 5, 6]);
  assert.equal(meshTriangles(new Mesh(shape(), mesh.material, 'points'), null), null);
  assert.equal(meshTriangles(new Mesh(new Geometry()), null), null);
  assert.equal(meshTriangles(new Object3D() as Mesh, null), null);
});
test('query traversal respects invisible and skipped ancestors while default collision keeps invisible walls', () => {
  const root = new Object3D(),
    visible = new Mesh(shape()),
    hidden = new Mesh(shape()),
    child = new Mesh(shape());
  hidden.visible = false;
  root.add(visible, hidden);
  hidden.add(child);
  const visit = (
    roots: Object3D | Object3D[],
    rule: { visibleOnly?: boolean; skip?: (n: Object3D) => boolean },
  ) => {
    const names: Object3D[] = [];
    forEachReadNode(roots, rule, (n) => names.push(n));
    return names;
  };
  assert.deepEqual(visit(root, {}), [root, visible, hidden, child]);
  assert.deepEqual(visit(root, { visibleOnly: true }), [root, visible]);
  assert.deepEqual(visit(child, { visibleOnly: true }), []);
  assert.deepEqual(visit(child, { skip: (n) => n === hidden }), []);
  assert.deepEqual(visit(root, { skip: (n) => n === hidden }), [root, visible]);
  assert.equal(meshCollision(root).tree.triangleCount, 3);
  assert.equal(meshCollision(root, (n) => n === hidden).tree.triangleCount, 1);
});
test('world matrices are refreshed and combined before collision triangles are copied', () => {
  const root = new Object3D(),
    child = new Mesh(shape());
  root.add(child);
  root.position.set(10, 20, 30);
  child.position.set(2, 3, 4);
  const world = meshCollision(root);
  assert.deepEqual([...world.tree.triangles], [13, 25, 37, 16, 28, 40, 19, 31, 43]);
  child.position.x = 99;
  assert.deepEqual([...world.tree.triangles], [13, 25, 37, 16, 28, 40, 19, 31, 43]);
});
test('triangle tree reports the bytes it owns and maps reordered triangles back to source ranks', () => {
  const source = Array.from({ length: 90 }, (_, i) => Math.sin(i) * 20),
    copy = [...source],
    ranks = new Uint32Array(10);
  const tree = buildTriangleTree(source, ranks);
  assert.deepEqual(source, copy);
  assert.equal(tree.triangleCount, 10);
  assert.equal(
    tree.bytes,
    [tree.triangles, tree.bounds, tree.links, tree.counts].reduce(
      (sum, array) => sum + array.byteLength,
      0,
    ),
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
