import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlyCameraControls } from './flyControls.ts';
import { createFirstPersonCameraControls } from './firstPersonControls.ts';
import { rotateByQuaternion } from '../../../../sdk-core/src/math/matrix/quaternion.ts';
import {
  fixtureCamera,
  fixtureDrag,
  fixtureSurface,
  type FixtureCamera,
} from './controls.fixture.ts';
import type { SteeredCameraControls } from './types.ts';

const round = (value: number, digits = 6) => Number(value.toFixed(digits)) + 0;
const facing = (camera: { quaternion: { x: number; y: number; z: number; w: number } }) => {
  const q = camera.quaternion;
  return rotateByQuaternion(new Float64Array(3), [q.x, q.y, q.z, q.w], 0, 0, -1);
};
const at = (camera: { position: { x: number; y: number; z: number } }) =>
  [round(camera.position.x), round(camera.position.y), round(camera.position.z)] as const;

/** One camera, one surface and the named controller, with its emissions counted. */
function steered<T extends SteeredCameraControls>(
  make: (camera: FixtureCamera, surface: HTMLElement) => T,
) {
  const camera = fixtureCamera(0, 0, 0),
    surface = fixtureSurface(400);
  const controls = make(camera, surface.element);
  let changes = 0;
  controls.addEventListener('change', () => changes++);
  return { camera, surface, controls, changes: () => changes };
}

test('flight integrates the keys held over the time step it is given', () => {
  const { camera, surface, controls } = steered(createFlyCameraControls);
  controls.movementSpeed = 2;
  assert.equal(controls.update(0.5), true); // The first call publishes the pose it starts from.
  assert.equal(controls.update(0.5), false);
  surface.key('keydown', { code: 'KeyW' });
  assert.equal(controls.update(0.5), true);
  assert.deepEqual(at(camera), [0, 0, -1]);
  // Two half steps and one whole step travel the same distance: the step is the only clock.
  controls.update(0.25);
  controls.update(0.25);
  assert.deepEqual(at(camera), [0, 0, -2]);
  surface.key('keyup', { code: 'KeyW' });
  assert.equal(controls.update(0.5), false);
  assert.deepEqual(at(camera), [0, 0, -2]);
});

test('flight strafes, rises and rolls on its own axes', () => {
  const { camera, surface, controls } = steered(createFlyCameraControls);
  controls.movementSpeed = 1;
  controls.rollSpeed = 0.4;
  controls.update(0);
  surface.key('keydown', { code: 'KeyD' });
  surface.key('keydown', { code: 'KeyR' });
  controls.update(1);
  assert.deepEqual(at(camera), [1, 1, 0]);
  surface.key('keyup', { code: 'KeyD' });
  surface.key('keyup', { code: 'KeyR' });
  surface.key('keydown', { code: 'KeyQ' });
  controls.update(1);
  // A roll turns the camera about what it looks at: the view direction does not move.
  const forward = facing(camera);
  assert.equal(round(forward[2]), -1);
  assert.ok(Math.abs(camera.quaternion.z - Math.sin(0.2)) < 1e-12);
});

test('flight looks where the drag went, and keys released leave the scene still', () => {
  const { camera, surface, controls, changes } = steered(createFlyCameraControls);
  controls.update(0);
  const before = changes();
  fixtureDrag(surface, 200, 0);
  controls.update(0);
  // Half the surface dragged sideways is a quarter turn of yaw, towards the drag.
  assert.deepEqual(
    [...facing(camera)].map((v) => round(v)),
    [1, 0, 0],
  );
  assert.ok(changes() > before);
  const settled = changes();
  assert.equal(controls.update(0.5), false);
  assert.equal(changes(), settled);
});

test('flight removes every listener on dispose, keys and window included', () => {
  const { surface, controls, camera } = steered(createFlyCameraControls);
  controls.update(0);
  assert.ok(surface.listeners() > 0);
  controls.dispose();
  assert.equal(surface.listeners(), 0);
  surface.key('keydown', { code: 'KeyW' });
  controls.update(1);
  assert.deepEqual(at(camera), [0, 0, 0]);
});

test('a window that loses focus releases the keys it will get no release for', () => {
  const { surface, controls, camera } = steered(createFlyCameraControls);
  controls.movementSpeed = 1;
  controls.update(0);
  surface.key('keydown', { code: 'KeyW' });
  surface.blur('blur', {});
  assert.equal(controls.update(1), false);
  assert.deepEqual(at(camera), [0, 0, 0]);
});

test('first person locks the pointer on the gesture and walks on the yaw alone', () => {
  const { camera, surface, controls } = steered(createFirstPersonCameraControls);
  controls.movementSpeed = 3;
  controls.update(0);
  surface.fire('pointerdown', { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  assert.equal(controls.locked(), true);
  surface.fire('pointermove', { pointerId: 1, movementX: 0, movementY: -2000 });
  controls.update(0);
  // Looking up is clamped short of the zenith, and the walk stays in the horizontal plane.
  const forward = facing(camera);
  assert.ok(forward[1] > 0.999 && forward[1] < 1);
  surface.key('keydown', { code: 'KeyW' });
  controls.update(1);
  assert.deepEqual(at(camera), [0, 0, -3]);
  surface.key('keydown', { code: 'Space' });
  controls.update(1);
  assert.equal(round(camera.position.y), 3);
});

test('first person turns the head with the pointer and lets the lock go on dispose', () => {
  const { camera, surface, controls } = steered(createFirstPersonCameraControls);
  controls.lookSpeed = Math.PI / 400;
  controls.update(0);
  surface.fire('pointerdown', { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  surface.fire('pointermove', { pointerId: 1, movementX: 200, movementY: 0 });
  controls.update(0);
  assert.deepEqual(
    [...facing(camera)].map((v) => round(v)),
    [1, 0, 0],
  );
  controls.dispose();
  assert.equal(controls.locked(), false);
  assert.equal(surface.listeners(), 0);
});
