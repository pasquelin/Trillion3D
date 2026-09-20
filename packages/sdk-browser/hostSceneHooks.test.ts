// The writes the contract lets the host make on a node or a light each increment the revision
// of the watch that hooked it, at the instant of the write; a write of the value already held
// increments nothing, and the reference's own matrix walk over an automatic node — which raises
// its update flag every frame — is not a host write.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hookHostNode, unhookHostNode, type WriteRevision } from './hostSceneHooks.ts';

const mark = (): WriteRevision => ({ revision: 0, shape: 0 });

function hooked() {
  const parent = new THREE.Group();
  const mesh = new THREE.Mesh();
  parent.add(mesh);
  const light = new THREE.SpotLight(0xffffff, 1, 10, 0.5, 0.2, 2);
  const revision = mark();
  for (const node of [parent, mesh, light]) hookHostNode(node, revision);
  return { parent, mesh, light, revision };
}

type Scene = ReturnType<typeof hooked>;
/** The mutation paths of a node and of a light: each bumps, and repeated as-is bumps nothing.
 *  A replacement repeats with the object it already put there. */
const WRITES: Array<{
  name: string;
  write: (s: Scene) => unknown;
  again?: (s: Scene, put: unknown) => void;
}> = [
  { name: 'a position component', write: ({ mesh }) => (mesh.position.x = 100) },
  { name: 'position.set', write: ({ mesh }) => mesh.position.set(1, 2, 3) },
  { name: 'scale.set', write: ({ mesh }) => mesh.scale.set(2, 2, 2) },
  { name: 'a rotation Euler component', write: ({ mesh }) => (mesh.rotation.y = 1) },
  {
    name: 'quaternion.setFromAxisAngle',
    write: ({ mesh }) => mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1),
  },
  { name: 'visible', write: ({ mesh }) => (mesh.visible = false) },
  { name: 'matrixAutoUpdate', write: ({ mesh }) => (mesh.matrixAutoUpdate = false) },
  { name: 'an ancestor pose', write: ({ parent }) => (parent.position.z = -4) },
  {
    name: 'reparenting',
    write: ({ mesh }) => new THREE.Group().add(mesh),
    again: ({ mesh }, put) => (mesh.parent = put as THREE.Group),
  },
  { name: 'light intensity', write: ({ light }) => (light.intensity = 7) },
  {
    name: 'light range and cone',
    write: ({ light }) => ((light.distance = 42), (light.angle = 0.1)),
  },
  { name: 'a light colour component', write: ({ light }) => light.color.setRGB(0.25, 0.5, 0.75) },
  {
    name: 'a light colour replaced',
    write: ({ light }) => (light.color = new THREE.Color(0xff0000)),
    again: ({ light }, put) => (light.color = put as THREE.Color),
  },
  {
    name: 'a light target replaced',
    write: ({ light }) => (light.target = new THREE.Object3D()),
    again: ({ light }, put) => (light.target = put as THREE.Object3D),
  },
];

for (const { name, write, again } of WRITES)
  test(`a write of ${name} bumps the revision`, () => {
    const scene = hooked();
    const put = write(scene);
    assert.ok(scene.revision.revision > 0, 'a write, an increment');
    scene.revision.revision = 0;
    if (again) again(scene, put);
    else write(scene);
    assert.equal(scene.revision.revision, 0, 'the same value written again is not a change');
  });

test('a colour replaced then written is still seen', () => {
  const { light, revision } = hooked();
  light.color = new THREE.Color(0xff0000);
  revision.revision = 0;
  light.color.g = 0.5;
  assert.equal(revision.revision, 1);
});

test('a matrix set by hand is announced by the update flag, once per matrix', () => {
  const { mesh, revision } = hooked();
  mesh.matrixAutoUpdate = false;
  revision.revision = 0;
  mesh.matrix.makeTranslation(5, 0, 0);
  mesh.matrixWorldNeedsUpdate = true;
  assert.equal(revision.revision, 1, 'the flag raised on a frozen node over a new matrix');
  mesh.matrixWorldNeedsUpdate = true;
  assert.equal(revision.revision, 1, 'raised again over the same matrix: nothing moved');
  mesh.updateMatrixWorld(true);
  assert.equal(mesh.matrixWorldNeedsUpdate, false, 'the reference cleared it on its walk');
  assert.equal(revision.revision, 1, 'clearing it announces nothing');
});

test('updateMatrix() each tick on a frozen node, pose unchanged, bumps nothing', () => {
  const { mesh, revision } = hooked();
  mesh.position.x = 3;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  revision.revision = 0;
  for (let tick = 0; tick < 5; tick++) mesh.updateMatrix();
  assert.equal(revision.revision, 0);
  mesh.position.x = 4;
  mesh.updateMatrix();
  assert.ok(revision.revision > 0, 'a pose recomposed into a new matrix is seen');
});

test("the reference's own walk over automatic nodes bumps nothing: a still scene stays still", () => {
  const { parent, mesh, light, revision } = hooked();
  parent.add(light);
  revision.revision = 0;
  for (let frame = 0; frame < 3; frame++) parent.updateMatrixWorld(true);
  assert.equal(mesh.matrixAutoUpdate, true);
  assert.equal(revision.revision, 0);
});

test('two watches on one node are both bumped; an unhooked one no longer is', () => {
  const { mesh, revision } = hooked();
  const other = mark();
  hookHostNode(mesh, other);
  hookHostNode(mesh, other);
  mesh.position.x = 1;
  assert.deepEqual([revision.revision, other.revision], [1, 1], 'registered once, bumped once');
  unhookHostNode(mesh, other);
  unhookHostNode(mesh, other);
  mesh.position.x = 2;
  assert.deepEqual([revision.revision, other.revision], [2, 1]);
});

test('a structural write — reparenting, retargeting — also moves the shape', () => {
  const { mesh, light, revision } = hooked();
  mesh.position.x = 1;
  assert.equal(revision.shape, 0, 'a pose write reshapes nothing');
  new THREE.Group().add(mesh);
  const reparented = revision.shape;
  assert.ok(reparented > 0, 'a reparented node changes its ancestor chain');
  light.target = new THREE.Object3D();
  assert.ok(revision.shape > reparented, 'a retargeted light names another chain');
});

test('the last watch to leave a node takes every accessor with it: a plain host object again', () => {
  const { mesh, light, revision } = hooked();
  const plain = new THREE.Mesh();
  for (const node of [mesh, light]) unhookHostNode(node, revision);
  for (const key of ['x', 'y', 'z'] as const)
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(mesh.position, key),
      Object.getOwnPropertyDescriptor(plain.position, key),
    );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(mesh, 'visible'),
    Object.getOwnPropertyDescriptor(plain, 'visible'),
  );
  mesh.position.x = 9;
  mesh.rotation.y = 1;
  light.intensity = 4;
  assert.equal(revision.revision, 0, 'no write reaches the watch any more');
  assert.equal(mesh.quaternion.y !== 0, true, 'the Euler still drives the quaternion');
});

test('the hooked fields read back what was written, for the host and for the reference', () => {
  const { mesh, light } = hooked();
  mesh.position.set(1, 2, 3);
  mesh.rotation.set(0.1, 0.2, 0.3);
  mesh.scale.set(2, 2, 2);
  mesh.visible = false;
  light.intensity = 3;
  light.color.setRGB(0.1, 0.2, 0.3);
  const twin = new THREE.Mesh();
  twin.position.set(1, 2, 3);
  twin.rotation.set(0.1, 0.2, 0.3);
  twin.scale.set(2, 2, 2);
  mesh.updateMatrix();
  twin.updateMatrix();
  assert.deepEqual(mesh.matrix.elements, twin.matrix.elements, 'the same composed matrix');
  assert.equal(mesh.visible, false);
  assert.deepEqual(
    [light.intensity, light.color.r, light.color.g, light.color.b],
    [3, 0.1, 0.2, 0.3],
  );
  assert.deepEqual(
    mesh.clone().position.toArray(),
    [1, 2, 3],
    'a clone copies through the accessors',
  );
});
