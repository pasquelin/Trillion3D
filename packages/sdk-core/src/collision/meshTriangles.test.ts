import test from 'node:test';
import assert from 'node:assert/strict';
import { meshTriangles, meshCollision, forEachReadNode } from './meshTriangles.ts';
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
