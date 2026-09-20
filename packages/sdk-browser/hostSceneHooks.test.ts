// The writes the contract lets the host make on a node or a light each increment the revision
// of the watch that hooked it, at the instant of the write; a write of the value already held
// increments nothing, and the reference's own matrix walk over an automatic node — which raises
// its update flag every frame — is not a host write.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hookHostNode, unhookHostNode, type WriteRevision } from './hostSceneHooks.ts';

const mark = (): WriteRevision => ({ revision: 0, reshaped: false });

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
  reshapes?: boolean;
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
    reshapes: true,
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
    reshapes: true,
    again: ({ light }, put) => (light.target = put as THREE.Object3D),
  },
];

for (const { name, write, reshapes, again } of WRITES)
  test(`a write of ${name} bumps the revision${reshapes ? ' and reshapes' : ''}`, () => {
    const scene = hooked();
    const put = write(scene);
    assert.ok(scene.revision.revision > 0, 'a write, an increment');
    assert.equal(scene.revision.reshaped, !!reshapes);
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

test('a matrix set by hand is announced by the update flag, as the reference requires', () => {
  const { mesh, revision } = hooked();
  mesh.matrixAutoUpdate = false;
  revision.revision = 0;
  mesh.matrix.makeTranslation(5, 0, 0);
  mesh.matrixWorldNeedsUpdate = true;
  assert.equal(revision.revision, 1, 'the flag raised on a frozen node is a write');
  mesh.matrixWorldNeedsUpdate = true;
  assert.equal(revision.revision, 2, 'raised again: another matrix was set');
  mesh.updateMatrixWorld(true);
  assert.equal(mesh.matrixWorldNeedsUpdate, false, 'the reference cleared it on its walk');
  assert.equal(revision.revision, 2, 'clearing it announces nothing');
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
  assert.equal(hookHostNode(mesh, other), true, 'a new registration');
  assert.equal(hookHostNode(mesh, other), false, 'already registered');
  mesh.position.x = 1;
  assert.deepEqual([revision.revision, other.revision], [1, 1]);
  assert.equal(unhookHostNode(mesh, other), true);
  assert.equal(unhookHostNode(mesh, other), false, 'already forgotten');
  mesh.position.x = 2;
  assert.deepEqual([revision.revision, other.revision], [2, 1]);
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
