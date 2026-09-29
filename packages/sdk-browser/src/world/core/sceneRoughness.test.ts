import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { minimumRoughness } from './sceneRoughness.ts';

const mesh = (roughness: number) =>
  new Mesh(new Geometry(), new Material('meshStandard', { roughness }));

test('the walk finds the smooth surface a lamp’s reach is bounded at', () => {
  const scene = object.group(),
    group = object.group();
  group.add(mesh(0.9), mesh(0.7), mesh(1));
  scene.add(group, mesh(0.95));
  assert.equal(minimumRoughness(scene), 0.7);
});

test('a list of materials is read whole, and a scene with none says so', () => {
  const scene = object.group();
  scene.add(new Mesh(new Geometry(), [mesh(0.8).material, mesh(0.6).material]));
  assert.equal(minimumRoughness(scene), 0.6);
  assert.equal(minimumRoughness(object.group()), undefined);
  assert.equal(minimumRoughness(object.group().add(object.group())), undefined);
});
