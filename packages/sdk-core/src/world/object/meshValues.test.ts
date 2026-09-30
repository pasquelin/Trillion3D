import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, type Primitive } from './mesh.ts';
import { Group } from './object3d.ts';
import { countingLink } from './sceneLink.fixture.ts';
import { Geometry } from '../geometry/geometry.ts';
import { Material } from '../material/material.ts';
import { BufferAttribute } from '../buffer/attribute.ts';
import { ObjectPhysics } from '../../physics/objectPhysics.ts';

test('mesh primitive and shadow defaults survive a shallow clone', () => {
  const primitives: Primitive[] = [
    'triangles',
    'points',
    'lineStrip',
    'lineSegments',
    'lineLoop',
    'sprite',
  ];
  for (const primitive of primitives) {
    const mesh = new Mesh(undefined, undefined, primitive);
    const copy = mesh.clone(false);
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.type, primitive === 'triangles' ? 'Mesh' : primitive);
    assert.equal(copy.type, mesh.type);
    assert.equal(copy.primitive, primitive);
    assert.equal(copy.geometry, mesh.geometry);
    assert.equal(copy.material, mesh.material);
  }
});

test('morph names and zero weights follow the first morphed attribute only', () => {
  const geometry = new Geometry();
  const named = new BufferAttribute(new Float32Array([1, 2, 3]), 3);
  named.name = 'smile';
  geometry.morphAttributes.position = [named, new BufferAttribute(new Float32Array(3), 3)];
  geometry.morphAttributes.normal = [named];
  const mesh = new Mesh(geometry);
  assert.deepEqual(mesh.morphTargetInfluences, [0, 0]);
  assert.deepEqual(mesh.morphTargetDictionary, { smile: 0, '1': 1 });
  mesh.morphTargetInfluences![0] = 0.75;
  mesh.updateMorphTargets();
  assert.deepEqual(mesh.morphTargetInfluences, [0, 0]);
});

test('replacing grouped materials notifies the world and releases every old listener', () => {
  const first = new Material('meshBasic'),
    second = new Material('meshBasic');
  const replacement = new Material('meshBasic');
  const mesh = new Mesh(new Geometry(), [first, second]);
  const scene = new Group(),
    { link, heard } = countingLink();
  scene._link = link;
  scene.add(mesh);
  heard.length = 0;
  first.opacity = 0.4;
  second.opacity = 0.6;
  assert.deepEqual(heard, [mesh, mesh]);
  mesh.material = replacement;
  assert.deepEqual(heard, [mesh, mesh, mesh]);
  heard.length = 0;
  first.opacity = 0.2;
  second.opacity = 0.3;
  assert.deepEqual(heard, []);
  replacement.opacity = 0.5;
  assert.deepEqual(heard, [mesh]);
  scene.remove(mesh);
  const geometry = new Geometry();
  mesh.geometry = geometry;
  mesh.material = [first, second];
  assert.deepEqual(
    [geometry._listeners.size, first._listeners.size, second._listeners.size],
    [0, 0, 0],
  );
});

test('physics assignment preserves supplied bodies, constructs options and reports removal', () => {
  const mesh = new Mesh(),
    { link, heard } = countingLink();
  mesh._link = link;
  assert.equal(mesh.physics, null);
  const body = new ObjectPhysics('kinematic');
  mesh.physics = body;
  assert.equal(mesh.physics, body);
  mesh.physics = { type: 'dynamic', mass: 7 };
  assert.ok(mesh.physics instanceof ObjectPhysics);
  assert.equal(mesh.physics.type, 'dynamic');
  assert.equal(mesh.physics.mass, 7);
  mesh.physics = null;
  assert.equal(mesh.physics, null);
  assert.deepEqual(heard, [mesh, mesh, mesh]);
});
