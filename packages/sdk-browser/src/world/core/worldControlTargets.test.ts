import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { VehicleInput } from '../../../../sdk-core/src/physics/vehicle.ts';
import { fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { createCharacterPort, createPhysicsCharacter } from '../../physics/physicsCharacter.ts';
import type { CharacterBodyFactory } from '../../../../sdk-core/src/collision/characterBody.ts';
import type { ToPhysics } from '../../physics/protocol.ts';
import { worldControlsHandle } from './worldControlsHandle.ts';
import { createWorld } from './world.ts';

test('the character is Jolt’s while the world’s physics runs, and the triangle tree’s once told it stopped', () => {
  const camera = new Camera('perspective');
  camera.position.set(0, 3, 0);
  const sent: ToPhysics[] = [];
  const port = createCharacterPort((message) => sent.push(message));
  port.flush();
  let running: CharacterBodyFactory | null = (settings) => createPhysicsCharacter(port, settings),
    told = () => {};
  const source = { body: () => running, watch: (listener: () => void) => (told = listener) };
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'character',
    () => camera,
    surface.element,
    () => {},
    source,
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
  assert.ok(port.hear, 'a frame alone never looks for the physics again');
  told();
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

test('NO_VEHICLE holds on every path: the world’s option, and a vehicle taken while driving', () => {
  assert.throws(() => createWorld('viewer', { controls: 'vehicle' }), { code: 'NO_VEHICLE' });
  const controls = worldControlsHandle(
    'none',
    () => new Camera('perspective'),
    fixtureSurface(400).element,
    () => {},
  );
  controls.vehicle = { drive: () => {} };
  controls.kind = 'vehicle';
  assert.throws(() => (controls.vehicle = null), { code: 'NO_VEHICLE' });
  assert.ok(controls.vehicle, 'the vehicle is kept');
  controls.kind = 'none';
  controls.vehicle = null;
  controls.dispose();
});

test('a vehicle let go of hears its keys released; the next hears the keys held at once', () => {
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'none',
    () => new Camera('perspective'),
    surface.element,
    () => {},
  );
  const first: VehicleInput[] = [],
    second: VehicleInput[] = [];
  controls.vehicle = { drive: (input) => first.push({ ...input }) };
  controls.kind = 'vehicle';
  surface.key('keydown', { code: 'KeyW' });
  controls.vehicle = { drive: (input) => second.push({ ...input }) };
  assert.deepEqual(first.at(-1), { throttle: 0, brake: 0, steer: 0, handbrake: false });
  assert.equal(second.at(-1)?.throttle, 1, 'the key held drives the new vehicle');
  controls.kind = 'none';
  assert.equal(second.at(-1)?.throttle, 0, 'the controls released drive it no more');
  controls.dispose();
});

// #831: the boss's car stayed at 0 km/h, N, 700 rpm on drive-a-car. A panel's checkbox or slider
// keeps the focus after a click, and a key pressed then was taken for typing: the car never heard
// it. Only a field a key types into keeps its keys.
test('a key pressed while a checkbox or a slider holds the focus drives; typed in a field not', () => {
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'none',
    () => new Camera('perspective'),
    surface.element,
    () => {},
  );
  const heard: VehicleInput[] = [];
  controls.vehicle = { drive: (input) => heard.push({ ...input }) };
  controls.kind = 'vehicle';
  const throttle = (target: object) => {
    surface.key('keydown', { code: 'KeyW', target });
    const pressed = heard.at(-1)?.throttle ?? 0;
    surface.key('keyup', { code: 'KeyW', target });
    return pressed;
  };
  assert.equal(throttle({ tagName: 'INPUT', type: 'checkbox' }), 1, 'a checkbox clicked');
  assert.equal(throttle({ tagName: 'INPUT', type: 'range' }), 1, 'a slider dragged');
  assert.equal(throttle({ tagName: 'BUTTON' }), 1, 'a button pressed');
  assert.equal(throttle({ tagName: 'INPUT', type: 'text' }), 0, 'a text field keeps its keys');
  assert.equal(throttle({ tagName: 'INPUT' }), 0, 'an input of no type is a text field');
  controls.dispose();
});
