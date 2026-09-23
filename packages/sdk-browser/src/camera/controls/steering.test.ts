import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlyCameraControls } from './flyControls.ts';
import { at, fixtureDrag, round } from './controls.fixture.ts';
import { facing, steered } from './steering.fixture.ts';

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

test('cruising flight moves at `movementSpeed` with no key; W adds, S halts, never backwards', () => {
  const { camera, surface, controls } = steered(createFlyCameraControls);
  controls.movementSpeed = 2;
  controls.update(0);
  assert.equal(controls.update(1), false); // Off by default: no key, no motion.
  controls.autoForward = true;
  assert.equal(controls.update(0.5), true);
  assert.deepEqual(at(camera), [0, 0, -1]);
  surface.key('keydown', { code: 'KeyW' });
  controls.update(0.5);
  assert.deepEqual(at(camera), [0, 0, -3]);
  surface.key('keyup', { code: 'KeyW' });
  surface.key('keydown', { code: 'KeyS' });
  assert.equal(controls.update(1), false);
  assert.deepEqual(at(camera), [0, 0, -3]);
  surface.key('keyup', { code: 'KeyS' });
  controls.autoForward = false;
  assert.equal(controls.update(1), false);
  assert.deepEqual(at(camera), [0, 0, -3]);
});

test('flight with `pointerLook` off keeps its orientation through a drag', () => {
  const { camera, surface, controls } = steered(createFlyCameraControls);
  controls.pointerLook = false;
  controls.update(0);
  fixtureDrag(surface, 200, 100);
  assert.equal(controls.update(0), false);
  assert.deepEqual(
    [...facing(camera)].map((v) => round(v)),
    [0, 0, -1],
  );
});

test('flight loops unbounded: pitch held for 2π/pitchSpeed comes back to the start', () => {
  const { camera, surface, controls } = steered(createFlyCameraControls);
  controls.pitchSpeed = Math.PI; // Apart from `rollSpeed`, which stays 0.4.
  controls.update(0);
  surface.key('keydown', { code: 'ArrowUp' });
  for (let i = 0; i < 200; i++) controls.update(2 / 200);
  const q = camera.quaternion;
  // A whole turn is the identity orientation, whichever sign the quaternion ends on.
  assert.ok(Math.abs(Math.abs(q.w) - 1) < 1e-9);
  assert.deepEqual(
    [...facing(camera)].map((v) => round(v)),
    [0, 0, -1],
  );
});

test('flight ramps a turn key over `inputResponse` seconds, and back once released', () => {
  const { camera, surface, controls } = steered(createFlyCameraControls);
  controls.rollSpeed = 1;
  controls.inputResponse = 1;
  controls.update(0);
  surface.key('keydown', { code: 'KeyQ' });
  controls.update(0.5); // Half the travel: half the rate over this step.
  assert.ok(Math.abs(camera.quaternion.z - Math.sin(0.125)) < 1e-12);
  surface.key('keyup', { code: 'KeyQ' });
  // The stick still travels back: the camera keeps turning until it is centred.
  assert.equal(controls.update(0.25), true);
  assert.equal(controls.update(0.25), false);
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

test('flight turns on its stick inputs as on held keys, summed with them and bounded', () => {
  const { camera, surface, controls } = steered(createFlyCameraControls);
  controls.rollSpeed = 1;
  controls.update(0);
  controls.rollInput = 0.5; // Half a stick: half the rate, as a key held halfway.
  assert.equal(controls.update(1), true);
  assert.ok(Math.abs(camera.quaternion.z - Math.sin(0.25)) < 1e-12);
  // Stick and key push the same way: full deflection, never more.
  surface.key('keydown', { code: 'KeyQ' });
  controls.update(1);
  assert.ok(Math.abs(camera.quaternion.z - Math.sin(0.75)) < 1e-12);
  surface.key('keyup', { code: 'KeyQ' });
  controls.rollInput = 0; // A centred stick leaves the scene still.
  assert.equal(controls.update(1), false);
});
