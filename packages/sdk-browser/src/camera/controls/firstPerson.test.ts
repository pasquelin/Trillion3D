import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirstPersonCameraControls } from './firstPersonControls.ts';
import { at, round } from './controls.fixture.ts';
import { facing, steered } from './steering.fixture.ts';

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

test('first person stops a downward look at `minPitch`', () => {
  const { camera, surface, controls } = steered(createFirstPersonCameraControls);
  controls.minPitch = -Math.PI / 4;
  controls.update(0);
  surface.fire('pointerdown', { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  surface.fire('pointermove', { pointerId: 1, movementX: 0, movementY: 100000 });
  controls.update(0);
  assert.equal(round(facing(camera)[1]), round(-Math.SQRT1_2));
});
