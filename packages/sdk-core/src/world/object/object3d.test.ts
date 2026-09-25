import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D } from './object3d.ts';
import { Light } from '../light/light.ts';
import { Camera } from '../camera/camera.ts';
import { Mesh } from './mesh.ts';
import { cloneObject } from './clone.ts';

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
