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

test('the first move after the lock is granted is dropped: the cursor jump never turns the head', () => {
  const { camera, surface, controls } = steered(createFirstPersonCameraControls);
  controls.lookSpeed = Math.PI / 400;
  controls.update(0);
  surface.fire('pointerdown', { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  surface.key('pointerlockchange', {});
  surface.fire('pointermove', { pointerId: 1, movementX: -900, movementY: 700 });
  surface.fire('pointermove', { pointerId: 1, movementX: 200, movementY: 0 });
  controls.update(0);
  assert.deepEqual(
    [...facing(camera)].map((v) => round(v)),
    [1, 0, 0],
  );
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

test('first person never captures a locked pointer, and a refused capture or lock never throws', async () => {
  const { surface, controls } = steered(createFirstPersonCameraControls);
  const press = (pointerId: number) =>
    surface.fire('pointerdown', { pointerId, button: 0, clientX: 0, clientY: 0 });
  press(1);
  surface.fire('pointerup', { pointerId: 1 });
  press(2);
  assert.deepEqual([controls.locked(), [...surface.captured]], [true, []]);
  controls.unlock();
  const refused = (name: string) => () => {
    throw new DOMException('refused', name);
  };
  const element = surface.element as unknown as Record<string, unknown>;
  Object.assign(element, {
    setPointerCapture: refused('InvalidStateError'),
    releasePointerCapture: refused('NotFoundError'),
    requestPointerLock: () => Promise.reject(new DOMException('too soon', 'SecurityError')),
  });
  press(3);
  surface.fire('pointerup', { pointerId: 3 });
  await new Promise((settled) => setTimeout(settled, 0));
  assert.equal(controls.locked(), false);
});

test('a steering key keeps its default action from the page, unless typed into a field', () => {
  const { camera, surface, controls } = steered(createFirstPersonCameraControls);
  const kept = (code: string, target: unknown = surface.element) => {
    let prevented = false;
    surface.key('keydown', { code, target, preventDefault: () => (prevented = true) });
    return prevented;
  };
  // Space would scroll the page; held, it repeats and is kept from it each time.
  assert.deepEqual([kept('Space'), kept('Space'), kept('KeyW')], [true, true, true]);
  assert.equal(kept('KeyZ'), false); // Not a key this controller steers with.
  for (const code of ['Space', 'KeyW']) surface.key('keyup', { code });
  assert.equal(kept('KeyW', { tagName: 'INPUT' }), false);
  assert.equal(kept('KeyA', { isContentEditable: true }), false);
  // What is typed into a field is the field's: the camera does not walk.
  controls.update(1);
  assert.deepEqual(at(camera), [0, 0, 0]);
});
