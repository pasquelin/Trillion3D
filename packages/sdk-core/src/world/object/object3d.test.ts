import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D } from './object3d.ts';
import { Light } from '../light/light.ts';
import { Camera } from '../camera/camera.ts';
import { Mesh } from './mesh.ts';
import { cloneObject } from './clone.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { mismatch } from '../../scene/core/nodeAttach.fixture.ts';
import { Quaternion } from '../math/quaternion.ts';
import { multiplyMatrix4 } from '../../math/matrix/matrix4.ts';
import { invertMatrix4 } from '../../math/matrix/matrix4Inverse.ts';
import { decomposeMatrix4 } from '../../math/matrix/matrix4Trs.ts';

// Re-deriving Euler angles from the quaternion would swap (0, y, 0) past ±90° for the equivalent
// (π, π − y, π); a later one-axis write would then keep x = z = π and turn the node another way.
test('angles written stay as written past ±90°, and a one-axis write turns only that axis', () => {
  const node = new Object3D();
  node.rotation.y = 2.7;
  assert.deepEqual([node.rotation.x, node.rotation.y, node.rotation.z], [0, 2.7, 0]);
  node.rotation.y = 2.8;
  const q = node.quaternion;
  assert.ok(Math.abs(q.x) < 1e-12 && Math.abs(q.z) < 1e-12, 'a pure turn about Y');
  assert.ok(Math.abs(Math.abs(q.y) - Math.sin(1.4)) < 1e-12);
});

test('a quaternion write still sets the angles it implies', () => {
  const node = new Object3D();
  node.quaternion.set(0, Math.sin(0.5), 0, Math.cos(0.5));
  assert.ok(Math.abs(node.rotation.y - 1) < 1e-12);
});

test('angles set after a quaternion write are the angles kept, and turn the node', () => {
  const node = new Object3D();
  node.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
  node.rotation.set(0.5, 0, 0);
  assert.deepEqual([node.rotation.x, node.rotation.y, node.rotation.z], [0.5, 0, 0]);
  assert.ok(
    Math.abs(node.quaternion.x - Math.sin(0.25)) < 1e-12 && Math.abs(node.quaternion.y) < 1e-12,
  );
});

test('a clone keeps its class: a group with its name and fields, a light, a camera', () => {
  const group = new Group();
  group.name = 'rig';
  group.position.set(1, 2, 3);
  group.renderOrder = 4;
  group.castShadow = true;
  group.userData = { tag: 'a' };
  group.add(new Group());
  const copy = group.clone();
  assert.ok(copy instanceof Group && copy.type === 'Group', 'a group stays a group');
  assert.equal(copy.name, 'rig');
  assert.deepEqual([copy.position.x, copy.position.y, copy.position.z], [1, 2, 3]);
  assert.ok(copy.renderOrder === 4 && copy.castShadow, 'its Object3D fields');
  assert.ok(copy.userData.tag === 'a' && copy.userData !== group.userData, 'its data, copied');
  assert.ok(copy.children[0] instanceof Group && copy.children[0] !== group.children[0]);
  assert.equal(group.clone(false).children.length, 0, 'children left behind when told');
  const spot = new Light('spot').clone();
  assert.ok(spot instanceof Light && spot.kind === 'spot' && spot.type === 'spotLight');
  const eye = new Camera('orthographic').clone();
  assert.ok(eye instanceof Camera && eye.projection === 'orthographic');
});

test("a clone keeps a light's values, a camera's optics, and shares a mesh's content", () => {
  const lamp = new Light('point', { color: 0xff0000, intensity: 5, distance: 9, sh: [1, 2] });
  lamp.target.position.set(0, 0, -4);
  for (const copy of [lamp.clone(), cloneObject(lamp)!]) {
    assert.ok(copy.color.getHex() === 0xff0000 && copy.intensity === 5 && copy.distance === 9);
    assert.ok(copy._values !== lamp._values && copy.sh !== lamp.sh && copy.sh?.[1] === 2);
    assert.equal(copy.target.position.z, -4, 'its aim');
  }
  const eye = new Camera('perspective', { fov: 20, near: 3 }).clone();
  assert.ok(eye.fov === 20 && eye.near === 3, 'its optics');
  const lines = new Mesh(undefined, undefined, 'lineSegments');
  const twin = lines.clone();
  assert.ok(twin.geometry === lines.geometry && twin.material === lines.material, 'shared');
  assert.equal(twin.primitive, 'lineSegments');
});

test('attach keeps the world matrix, and position, rotation and scale hold the new pose', () => {
  const [from, to, node] = [new Group(), new Group(), new Object3D()];
  from.position.set(1, 2, 3);
  from.rotation.set(0, Math.PI / 2, 0);
  from.scale.set(2, 3, 4);
  to.position.set(-4, 0, 1);
  to.rotation.set(Math.PI / 2, 0, 0);
  from.add(node);
  node.position.set(1, -1, 2);
  node.updateWorldMatrix(true, false);
  const world = node.matrixWorld.clone();
  assert.equal(to.attach(node), to);
  assert.equal(node.parent, to);
  node.updateMatrixWorld(true);
  assert.equal(mismatch(node.matrixWorld.elements, world.elements), null, 'its world matrix, kept');
  const posed = new Matrix4().compose(node.position, node.quaternion, node.scale);
  assert.equal(
    mismatch(posed.premultiply(to.matrixWorld).elements, world.elements),
    null,
    'its values',
  );
  to.attach(to);
  assert.ok(to.parent === null && to.position.x === -4, 'attached to itself: declined, untouched');
  const turn = new Quaternion().setFromEuler(node.rotation);
  assert.ok(Math.abs(Math.abs(turn.dot(node.quaternion)) - 1) < 1e-12, 'its angles follow');
});

test("attach gives the reference's pose to the bit: new parent's inverse × old parent × local", () => {
  const product = new Float64Array(16);
  const [p, q, s] = [new Float64Array(3), new Float64Array(4), new Float64Array(3)];
  const wave = (k: number) => Math.sin(k * 12.9898) * 3; // unrounded values, fixed from run to run
  for (let i = 0; i < 16; i++) {
    const [from, to, node] = [new Group(), new Group(), new Object3D()];
    let k = i * 27 + 1;
    for (const object of [from, to, node]) {
      object.position.set(wave(k++), wave(k++), wave(k++));
      object.rotation.set(wave(k++), wave(k++), wave(k++));
      object.scale.set(2 + wave(k++) / 2, 2 + wave(k++) / 2, 2 + wave(k++) / 2);
    }
    from.add(node);
    node.matrixAutoUpdate = i % 2 === 0; // manual update: the matrix is the pose
    node.updateMatrix();
    to.updateWorldMatrix(true, false);
    node.updateWorldMatrix(true, false);
    invertMatrix4(product, to.matrixWorld.elements);
    multiplyMatrix4(product, product, from.matrixWorld.elements as Float64Array);
    multiplyMatrix4(product, product, node.matrix.elements as Float64Array);
    decomposeMatrix4(product, p, q, s);
    to.attach(node);
    const pose = [...node.position.elements, ...node.quaternion.elements, ...node.scale.elements];
    assert.equal(mismatch(pose, [...p, ...q, ...s], 0), null, `attach ${i}: its values`);
    if (!node.matrixAutoUpdate) assert.equal(mismatch(node.matrix.elements, product, 0), null);
  }
});
