import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { VehicleInput } from '../../../../sdk-core/src/physics/vehicle.ts';
import { fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import type { CharacterPort } from '../../physics/physicsCharacter.ts';
import type { ToPhysics } from '../../physics/protocol.ts';
import { worldControlsHandle } from './worldControlsHandle.ts';

test('the character is Jolt’s while the world’s physics runs, and the triangle tree’s after', () => {
  const camera = new Camera('perspective');
  camera.position.set(0, 3, 0);
  const sent: ToPhysics[] = [];
  const port: CharacterPort = { send: (message) => sent.push(message), hear: null };
  let running: CharacterPort | null = port;
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'character',
    () => camera,
    surface.element,
    () => {},
    () => running,
  );
  controls.update(1 / 60);
  assert.equal(sent[0]?.type, 'character', 'the body is made in the worker');
  assert.ok(port.hear, 'the page listens to its reports');
  port.hear!({
    feet: [1, 0, 0],
    velocity: [0, 0, 0],
    motion: [0, 0, 0],
    grounded: true,
    landed: -1,
    jumps: 0,
  });
  controls.update(1 / 60);
  assert.ok(Math.abs(camera.position.x - 1) < 1e-9, 'the eye follows the worker’s feet');
  running = null;
  controls.update(1 / 60);
  assert.deepEqual(sent.at(-1), { type: 'character', settings: null, feet: null });
  assert.equal(port.hear, null, 'the worker’s body is released');
  controls.dispose();
});

test('`kind = "vehicle"` throws NO_VEHICLE without a vehicle, and drives one with the keys', () => {
  const camera = new Camera('perspective');
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'none',
    () => camera,
    surface.element,
    () => {},
  );
  assert.throws(() => (controls.kind = 'vehicle'), { code: 'NO_VEHICLE' });
  assert.equal(controls.kind, 'none');
  const heard: VehicleInput[] = [];
  controls.vehicle = { drive: (input) => heard.push({ ...input }) };
  controls.kind = 'vehicle';
  surface.key('keydown', { code: 'KeyW' });
  surface.key('keydown', { code: 'KeyA' });
  surface.key('keydown', { code: 'Space' });
  assert.deepEqual(heard.at(-1), { throttle: 1, brake: 0, steer: -1, handbrake: true });
  surface.key('keyup', { code: 'KeyW' });
  assert.equal(heard.at(-1)?.throttle, 0);
  controls.dispose();
});
