import test from 'node:test';
import assert from 'node:assert/strict';
import { at, fixtureDrag, fixtureOrbit as orbit, round } from './controls.fixture.ts';

/** A leg of the right isosceles triangle a ten-unit orbit draws at a quarter of π. */
const LEG = round(10 * Math.SQRT1_2);

test('orbit starts with its angles unbounded: a full turn of azimuth, pole to pole', () => {
  const { camera, controls, surface } = orbit(10);
  assert.deepEqual([controls.minPolarAngle, controls.maxPolarAngle], [0, Math.PI]);
  assert.deepEqual([controls.minAzimuthAngle, controls.maxAzimuthAngle], [-Infinity, Infinity]);
  controls.update();
  // Three hundred pixels of a four-hundred-pixel surface: three quarters of a turn, unclamped.
  fixtureDrag(surface, 300, 0);
  assert.deepEqual(at(camera), [10, 0, 0]);
});

test('orbit holds the polar angle between its bounds, on a drag and on `update()`', () => {
  const { camera, controls, surface } = orbit(10);
  controls.maxPolarAngle = Math.PI / 2;
  controls.update();
  // Dragging up would take the camera under the ground; the horizon stops it.
  fixtureDrag(surface, 0, -100);
  assert.deepEqual(at(camera), [0, 0, 10]);
  controls.minPolarAngle = Math.PI / 4;
  fixtureDrag(surface, 0, 1000);
  assert.deepEqual(at(camera), [0, LEG, LEG]);
  // A pose the host writes below the ground is lifted back to the horizon.
  camera.position.set(0, -10, 0.001);
  controls.update();
  assert.equal(round(camera.position.y), 0);
  assert.equal(round(camera.position.distanceTo(controls.target)), 10);
});

test('orbit holds the azimuth on its arc, the arc behind the target included', () => {
  const { camera, controls, surface } = orbit(10);
  controls.minAzimuthAngle = -Math.PI / 4;
  controls.maxAzimuthAngle = Math.PI / 4;
  controls.update();
  fixtureDrag(surface, 100, 0);
  assert.deepEqual(at(camera), [-LEG, 0, LEG]);
  fixtureDrag(surface, -150, 0);
  assert.deepEqual(at(camera), [LEG, 0, LEG]);
  // An arc from 3π/4 to −3π/4 crosses the back, where the azimuth jumps from π to −π.
  controls.minAzimuthAngle = (3 * Math.PI) / 4;
  controls.maxAzimuthAngle = (-3 * Math.PI) / 4;
  camera.position.set(0, 0, -10);
  controls.update();
  fixtureDrag(surface, 25, 0);
  assert.ok(camera.position.x > 0 && camera.position.z < -9);
  fixtureDrag(surface, 100, 0);
  assert.deepEqual(at(camera), [LEG, 0, -LEG]);
});
