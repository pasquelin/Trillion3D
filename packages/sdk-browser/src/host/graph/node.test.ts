/**
 * A group and a bare node of the graph are the core's own: a copy of a subtree keeps each node's
 * class — the core's group, the engine's mesh — its pose and its flags, and shares the mesh's
 * surface, as the reference's copy does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { GraphMesh } from './mesh.ts';
import { GraphSurface } from './surface.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

test('a copied subtree keeps the core group, the bare node and the mesh, each posed', () => {
  const surface = new GraphSurface('basic');
  const group = new Group(),
    bare = new Object3D(),
    mesh = new GraphMesh(new Geometry(), surface);
  group.add(bare.add(mesh));
  group.name = 'rig';
  group.position.set(1, 2, 3);
  bare.visible = false;
  mesh.renderOrder = 4;
  const copy = group.clone();
  assert.ok(copy instanceof Group, 'a group stays a group');
  assert.equal(copy.name, 'rig');
  assert.deepEqual([copy.position.x, copy.position.y, copy.position.z], [1, 2, 3]);
  const [bareCopy] = copy.children;
  assert.ok(!(bareCopy instanceof Group) && bareCopy.visible === false, 'the bare node, hidden');
  const [meshCopy] = bareCopy.children;
  assert.ok(meshCopy instanceof GraphMesh && meshCopy !== mesh, 'the mesh, copied');
  assert.equal(meshCopy.material, surface, 'sharing its surface');
  assert.equal(meshCopy.renderOrder, 4);
  assert.equal(group.clone(false).children.length, 0, 'children left behind when told');
});
