import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { fixtureDrag, fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { facing } from '../../camera/controls/steering.fixture.ts';
import { worldControlsHandle } from './worldControlsHandle.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import type { CharacterCollision } from '../../../../sdk-core/src/collision/characterCollision.ts';
import type { CapsuleContact } from '../../../../sdk-core/src/collision/capsule.ts';

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

test('`world.controls` keeps its speeds across `kind`: first person walks at `movementSpeed`, flight turns at `lookSpeed`', () => {
  const camera = new Camera('perspective');
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'orbit',
    () => camera,
    surface.element,
    () => {},
  );
  // Set on a controller that has no walk: harmless, and kept for the one that comes next.
  assert.equal(controls.lookSpeed, null); // Each controller's own until set.
  controls.movementSpeed = 5;
  controls.lookSpeed = Math.PI / 200;
  controls.kind = 'firstPerson';
  controls.kind = 'fly';
  controls.kind = 'firstPerson';
  assert.equal(controls.movementSpeed, 5);
  controls.update(0);
  surface.key('keydown', { code: 'KeyW' });
  controls.update(1);
  assert.equal(Number(camera.position.length().toFixed(6)), 5);
  controls.kind = 'fly';
  controls.update(0);
  fixtureDrag(surface, 100, 0); // A quarter turn at π/200 per pixel: the look faces +X.
  controls.update(0);
  assert.deepEqual(
    [...facing(camera)].map((v) => Math.round(v) + 0),
    [1, 0, 0],
  );
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

test('`world.controls` asks for a frame when a stick input is set on a still flight', () => {
  const camera = new Camera('perspective');
  const surface = fixtureSurface(400);
  let redraws = 0;
  const controls = worldControlsHandle(
    'fly',
    () => camera,
    surface.element,
    () => redraws++,
  );
  controls.update(0);
  const settled = redraws;
  controls.movementSpeed = 2; // Nothing moves on its own: no frame.
  assert.equal(redraws, settled);
  controls.yawInput = 0.5;
  assert.equal(redraws, settled + 1);
  controls.dispose();
});

/** A physics backend's world reduced to its seam: an endless floor at y = 0. */
function endlessFloor(): CharacterCollision & { asked: number } {
  const contact: CapsuleContact = {
    normal: new Float64Array([0, 1, 0]),
    surface: new Float64Array([0, 1, 0]),
    point: new Float64Array(3),
    depth: 0,
  };
  const world = {
    asked: 0,
    resolveCapsule(capsule: { feet: Float64Array }, push: (contact: CapsuleContact) => void) {
      world.asked++;
      if (capsule.feet[1] >= 0) return false;
      contact.point.set([capsule.feet[0], 0, capsule.feet[2]]);
      contact.depth = -capsule.feet[1];
      push(contact);
      return true;
    },
    groundBelow(
      capsule: { feet: Float64Array },
      depth: number,
      accepts: (contact: CapsuleContact) => boolean,
    ) {
      contact.point.set([capsule.feet[0], 0, capsule.feet[2]]);
      return capsule.feet[1] <= depth && accepts(contact) ? capsule.feet[1] : null;
    },
  };
  return world;
}

test('`world.controls.colliders` takes a CharacterCollision as it is, and the body stands on it', () => {
  const camera = new Camera('perspective');
  camera.position.set(0, 3, 0);
  const surface = fixtureSurface(400);
  const controls = worldControlsHandle(
    'character',
    () => camera,
    surface.element,
    () => {},
  );
  const floor = endlessFloor();
  controls.colliders = floor;
  assert.equal(controls.colliders, floor);
  for (let i = 0; i < 120; i++) controls.update(1 / 60);
  assert.ok(floor.asked > 0, 'the world was asked');
  assert.equal(controls.onGround, true);
  assert.ok(Math.abs(camera.position.y - controls.eyeHeight) < 1e-6, `eye at ${camera.position.y}`);
  controls.dispose();
});
