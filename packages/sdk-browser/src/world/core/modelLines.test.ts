import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { LoadedModel, type ModelRecord } from './loadedModel.ts';
import { createWorldMembers } from './worldMembers.ts';

test('imported line instances enter the world cutter and preserve parent poses and shared geometry', () => {
  const shape = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0]), 3),
  });
  const surface = new GraphSurface('basic', { opacity: 0.5, transparent: true });
  const source = new Object3D(),
    parent = new Object3D();
  parent.position.set(10, 20, 30);
  source.add(parent);
  for (let i = 0; i < 2; i++) {
    const line = new Mesh(shape, surface, 'lineSegments');
    line.name = `edge${i}`;
    line.position.x = i;
    parent.add(line);
  }
  const model = new LoadedModel({ scene: { source } } as ModelRecord);
  const world = new Object3D().add(model);
  const members = createWorldMembers(world);
  members.changed(world);
  members.take();
  assert.equal(members.meshes.size, 2);
  const [first, second] = [...members.meshes];
  assert.equal(first.geometry, second.geometry);
  assert.equal(first.material, second.material);
  assert.equal(first.primitive, 'lineSegments');
  assert.equal(first.parent!.position.y, 20);
  assert.equal(second.position.x, 1);
  assert.equal(model.getObjectByName('edge0'), first);
  const drawn = drawnTriangles(first.geometry, first.primitive)!;
  assert.equal(drawn.lines, true);
  assert.equal(drawn.indices.length, 6);
  assert.equal(drawn.positions.length, 12);
});
