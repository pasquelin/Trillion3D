import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { fixtureDrag, fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { worldControlsHandle } from './worldControlsHandle.ts';

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
