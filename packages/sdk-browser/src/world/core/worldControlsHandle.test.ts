import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { fixtureDrag, fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { worldControlsHandle } from './worldControlsHandle.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';

test('`world.controls` hands its limits to the orbit it drives, and keeps them for the next', () => {
  const camera = new Camera('perspective');
  camera.position.set(0, 5, 10);
  const surface = fixtureSurface(400);
  let redraws = 0;
  const controls = worldControlsHandle(
    'fly',
    () => camera,
    surface.element,
    () => redraws++,
  );
  // Set while flying: harmless, and kept for the orbit that comes next.
  controls.maxPolarAngle = Math.PI / 2;
  controls.kind = 'orbit';
  assert.equal(controls.maxPolarAngle, Math.PI / 2);
  // A long drag up would take the camera under the ground; the limit reached the orbit.
  fixtureDrag(surface, 0, -1000);
  assert.ok(redraws > 0);
  assert.equal(Number(camera.position.y.toFixed(6)) + 0, 0);
  controls.dispose();
});

test('`world.controls` keeps its speeds across `kind`, and first person walks at `movementSpeed`', () => {
  const camera = new Camera('perspective');
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'orbit',
    () => camera,
    surface.element,
    () => {},
  );
  // Set on a controller that has no walk: harmless, and kept for the one that comes next.
  controls.movementSpeed = 5;
  controls.kind = 'firstPerson';
  controls.kind = 'fly';
  controls.kind = 'firstPerson';
  assert.equal(controls.movementSpeed, 5);
  controls.update(0);
  surface.key('keydown', { code: 'KeyW' });
  controls.update(1);
  assert.equal(Number(camera.position.length().toFixed(6)), 5);
  controls.dispose();
});

test('`world.controls.autoForward` cruises flight alone, kept across kinds, and asks for a frame', () => {
  const camera = new Camera('perspective');
  const surface = fixtureSurface(400);
  let redraws = 0;
  const controls = worldControlsHandle(
    'orbit',
    () => camera,
    surface.element,
    () => redraws++,
  );
  // Set on the orbit: harmless, no frame asked, and kept for the flight that comes next.
  controls.autoForward = true;
  assert.equal(redraws, 0);
  controls.movementSpeed = 3;
  controls.kind = 'fly';
  assert.equal(controls.autoForward, true);
  assert.ok(redraws > 0);
  controls.update(0);
  controls.update(1);
  assert.equal(Number(camera.position.length().toFixed(6)), 3);
  // A disabled controller does not cruise: the scene is still again.
  controls.enabled = false;
  const settled = redraws;
  controls.update(1);
  assert.equal(redraws, settled);
  assert.equal(Number(camera.position.length().toFixed(6)), 3);
  controls.dispose();
});

test('`world.controls` as a character falls onto its colliders, walks, jumps, and rests still', () => {
  const camera = new Camera('perspective');
  camera.position.set(0, 3, 0);
  const surface = fixtureSurface(400);
  let redraws = 0;
  const controls = worldControlsHandle(
    'character',
    () => camera,
    surface.element,
    () => redraws++,
  );
  const floor = new Mesh(box(100, 1, 100));
  floor.position.set(0, -0.5, 0);
  controls.colliders = floor;
  const live = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) controls.update(1 / 60);
  };
  live(2);
  assert.equal(controls.onGround, true);
  assert.ok(Math.abs(camera.position.y - controls.eyeHeight) < 1e-6);
  surface.key('keydown', { code: 'KeyW' });
  live(1);
  assert.ok(camera.position.z < -3 && controls.velocity.z < -3, `walked to ${camera.position.z}`);
  surface.key('keyup', { code: 'KeyW' });
  live(2);
  const before = redraws;
  live(1);
  assert.equal(redraws, before, 'a character at rest asks for no frame');
  let jumps = 0;
  controls.onJump = () => jumps++;
  surface.key('keydown', { code: 'Space' });
  live(0.1);
  assert.equal(jumps, 1);
  assert.ok(controls.velocity.y > 0 && !controls.onGround);
  controls.dispose();
});
