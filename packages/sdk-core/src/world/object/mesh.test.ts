/**
 * A mesh costs what it holds (#874): its shape, its matter and how it reads them. The flag, the
 * morph weights and the listener live on the class or appear when used; the geometry and the
 * materials hear the mesh only while it is in a world.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from './mesh.ts';
import { Group } from './object3d.ts';
import { Geometry } from '../geometry/geometry.ts';
import { BufferAttribute } from '../buffer/attribute.ts';
import { Material } from '../material/material.ts';
import { countingLink } from './sceneLink.fixture.ts';

test('a mesh holds its shape, its matter and its primitive, nothing more of its own', () => {
  const mesh = new Mesh(new Geometry(), new Material('meshBasic'));
  const own = Object.keys(new Group());
  const added = Object.keys(mesh).filter((key) => !own.includes(key));
  assert.deepEqual(added.sort(), ['_geometry', '_material', 'primitive']);
  assert.equal(mesh.isMesh, true, 'the flag reads from the class');
  assert.equal(mesh.morphTargetInfluences, undefined, 'no morph, no weights');
});

test('a mesh is heard by its geometry and materials only while it is in a world', () => {
  const geometry = new Geometry(),
    material = new Material('meshBasic');
  const mesh = new Mesh(geometry, material);
  assert.equal(geometry._listeners.size + material._listeners.size, 0, 'outside a world: none');
  const scene = new Group(),
    { link, heard } = countingLink();
  scene._link = link;
  scene.add(mesh);
  assert.deepEqual([geometry._listeners.size, material._listeners.size], [1, 1]);
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  material.opacity = 0.5;
  assert.ok(heard.filter((node) => node === mesh).length >= 2, 'both changes reach the world');
  const other = new Geometry();
  mesh.geometry = other;
  assert.deepEqual([geometry._listeners.size, other._listeners.size], [0, 1], 'the new shape');
  scene.remove(mesh);
  assert.equal(other._listeners.size + material._listeners.size, 0, 'left the world: none');
  scene.add(mesh);
  scene.remove(mesh);
  scene.add(mesh);
  assert.deepEqual([other._listeners.size, material._listeners.size], [1, 1], 'relinked: once');
});

test('a mesh wearing matter that tells nothing enters and leaves a world', () => {
  const scene = new Group(),
    mesh = new Mesh<object>(new Geometry(), {});
  scene._link = countingLink().link;
  scene.add(mesh);
  scene.remove(mesh);
  assert.equal(mesh.geometry._listeners.size, 0);
});

test('a mesh destroyed in a world leaves it, heard by nothing it wore', () => {
  const geometry = new Geometry(),
    material = new Material('meshBasic');
  const scene = new Group(),
    group = new Group(),
    mesh = new Mesh(geometry, material),
    told: object[] = [];
  scene._link = { ...countingLink().link, structure: (node: object) => told.push(node) };
  group.add(mesh);
  scene.add(group);
  told.length = 0;
  group.destroy();
  assert.equal(geometry._listeners.size + material._listeners.size, 0);
  assert.deepEqual([group._link, mesh._link, scene.children.length], [null, null, 0]);
  assert.deepEqual(told, [scene], 'the world is told its structure changed');
});
