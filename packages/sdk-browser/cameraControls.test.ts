import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbitCameraControls } from './cameraOrbitControls.ts';
import { createTrackballCameraControls } from './cameraTrackballControls.ts';
import { createPanZoomCameraControls } from './cameraPanZoomControls.ts';
import { fixtureCamera, fixtureDrag, fixtureSurface } from './cameraControlsFixture.ts';

/** Rounded, and `+ 0` so a negative zero reads as the zero a reader expects. */
const round = (value: number, digits = 6) => Number(value.toFixed(digits)) + 0;
const at = (camera: { position: { x: number; y: number; z: number } }) =>
  [round(camera.position.x), round(camera.position.y), round(camera.position.z)] as const;

function orbit(distance = 10) {
  const camera = fixtureCamera(0, 0, distance),
    surface = fixtureSurface(400);
  const controls = createOrbitCameraControls(camera, surface.element);
  let changes = 0;
  controls.addEventListener('change', () => changes++);
  return { camera, surface, controls, changes: () => changes };
}

test('orbit clamps the distance the host asked for, and emits once for it', () => {
  const { camera, controls, changes } = orbit(10);
  controls.minDistance = 2;
  controls.maxDistance = 8;
  assert.equal(controls.update(), true);
  assert.deepEqual(at(camera), [0, 0, 8]);
  assert.equal(changes(), 1);
  // A still scene: nothing moved, nothing emitted, and the host schedules no frame.
  assert.equal(controls.update(), false);
  assert.equal(changes(), 1);
  camera.position.set(0, 0, 0.5);
  assert.equal(controls.update(), true);
  assert.deepEqual(at(camera), [0, 0, 2]);
});

test('orbit reads back the pose the host wrote, target included', () => {
  const { camera, controls } = orbit(10);
  // The host moves the pivot: the eye stays where it was and now looks at the new pivot.
  controls.target.set(0, 3, 0);
  controls.update();
  assert.deepEqual(at(camera), [0, 0, 10]);
  assert.equal(round(camera.position.distanceTo(controls.target)), round(Math.hypot(3, 10)));
  // And the host moves the eye, as the portal's zoom buttons do.
  camera.position.set(0, 3, 4);
  controls.update();
  assert.deepEqual(at(camera), [0, 3, 4]);
});

test('orbit turns with the drag and stops short of the poles', () => {
  const { camera, controls, surface } = orbit(10);
  controls.update();
  fixtureDrag(surface, 100, 0);
  // A hundred pixels of a four-hundred-pixel surface is a quarter turn of azimuth.
  assert.deepEqual(at(camera), [-10, 0, 0]);
  // Dragging down lifts the camera over the top, and the pole itself stays out of reach.
  fixtureDrag(surface, 0, 1000);
  assert.ok(camera.position.y > 9.999 && camera.position.y < 10);
  assert.equal(round(camera.position.distanceTo(controls.target)), 10);
});

test('orbit zooms on the wheel, bounded, and only while `enableZoom`', () => {
  const { camera, controls, surface } = orbit(10);
  controls.minDistance = 4;
  controls.maxDistance = 40;
  controls.update();
  surface.fire('wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(round(camera.position.z), round(10 / 0.95));
  surface.fire('wheel', { deltaY: -100, deltaMode: 0 });
  assert.equal(round(camera.position.z), 10);
  controls.enableZoom = false;
  surface.fire('wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(round(camera.position.z), 10);
});

test('orbit pans the pivot on the secondary button, camera and target together', () => {
  const { camera, controls, surface } = orbit(10);
  controls.update();
  fixtureDrag(surface, 40, 0, { button: 2 });
  assert.ok(controls.target.x < 0 && round(controls.target.y) === 0);
  assert.equal(round(camera.position.x), round(controls.target.x));
  assert.equal(round(camera.position.distanceTo(controls.target)), 10);
});

test('orbit removes every listener on dispose, and moves no more', () => {
  const { camera, controls, surface } = orbit(10);
  controls.update();
  assert.ok(surface.listeners() > 0);
  controls.dispose();
  assert.equal(surface.listeners(), 0);
  const before = at(camera);
  fixtureDrag(surface, 100, 0);
  assert.deepEqual(at(camera), before);
  controls.dispose();
});

test('the trackball spins about the screen axes and keeps the pivot distance', () => {
  const camera = fixtureCamera(0, 0, 10),
    surface = fixtureSurface(400);
  const controls = createTrackballCameraControls(camera, surface.element);
  controls.update();
  fixtureDrag(surface, 100, 0);
  assert.deepEqual(at(camera), [-10, 0, 0]);
  // A free trackball tilts the horizon; the turntable keeps it level.
  fixtureDrag(surface, 0, 100);
  assert.equal(round(camera.position.distanceTo(controls.target)), 10);
  assert.ok(camera.position.y > 0);
  controls.turntable = true;
  const tilted = camera.quaternion.z;
  fixtureDrag(surface, 50, 0);
  assert.notEqual(camera.quaternion.z, tilted);
  assert.equal(round(camera.position.distanceTo(controls.target)), 10);
});

test('the planar pan-zoom slides and dollies without ever turning the camera', () => {
  const camera = fixtureCamera(0, 2, 10),
    surface = fixtureSurface(400);
  const controls = createPanZoomCameraControls(camera, surface.element);
  controls.minDistance = 1;
  controls.maxDistance = 30;
  controls.update();
  const facing = { ...camera.quaternion },
    span = camera.position.distanceTo(controls.target);
  fixtureDrag(surface, 40, 20);
  assert.ok(camera.position.x < 0 && camera.position.y > 2);
  assert.deepEqual({ ...camera.quaternion }, facing);
  surface.key('keydown', { code: 'ArrowRight' });
  assert.ok(camera.position.x > -1);
  surface.fire('wheel', { deltaY: -100, deltaMode: 0 });
  assert.equal(round(camera.position.distanceTo(controls.target)), round(span * 0.95));
  assert.deepEqual({ ...camera.quaternion }, facing);
  controls.dispose();
  assert.equal(surface.listeners(), 0);
});
