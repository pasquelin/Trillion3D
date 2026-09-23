import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { fixtureSurface } from '../../camera/controls/controls.fixture.ts';
import { worldControlsHandle } from './worldControlsHandle.ts';

/** `world.controls` of `kind` over a fresh camera at `(0, y, 10)`, its frame requests counted. */
function handle(kind: 'character' | 'orbit', y = 0) {
  const camera = new Camera('perspective');
  camera.position.set(0, y, 10);
  const surface = fixtureSurface(400);
  let redraws = 0;
  const controls = worldControlsHandle(
    kind,
    () => camera,
    surface.element,
    () => redraws++,
  );
  return { camera, surface, controls, redraws: () => redraws };
}

test('`world.controls.enabled = false` pauses a jump mid-air, and `true` resumes it exactly', () => {
  const { camera, surface, controls } = handle('character', 1.64);
  const floor = new Mesh(box(100, 1, 100));
  floor.position.set(0, -0.5, 0);
  controls.colliders = floor;
  const live = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) controls.update(1 / 60);
  };
  live(0.5);
  surface.key('keydown', { code: 'Space' });
  live(0.1);
  const rising = controls.velocity.y,
    height = camera.position.y;
  assert.ok(rising > 0 && !controls.onGround);
  controls.enabled = false;
  live(1); // Paused: nothing moves, nothing falls.
  surface.key('keydown', { code: 'KeyW' }); // Nor is a key heard.
  assert.equal(camera.position.y, height);
  controls.enabled = true;
  assert.equal(controls.velocity.y, rising);
  assert.equal(controls.onGround, false);
  controls.update(1 / 60);
  assert.ok(camera.position.y > height, 'the jump goes on');
  assert.equal(camera.position.z, 10, 'the key pressed while paused was not heard');
  controls.dispose();
});

test('`world.controls.autoRotate` turns an orbit on every frame and asks for the first', () => {
  const { camera, controls, redraws } = handle('orbit');
  controls.autoRotate = Math.PI / 2;
  assert.equal(redraws(), 1);
  controls.update(1);
  assert.deepEqual(
    [camera.position.x, camera.position.z].map((v) => Math.round(v * 1e6) / 1e6 + 0),
    [10, 0],
  );
  controls.enabled = false;
  controls.update(1); // Paused, the turn waits.
  assert.equal(Math.round(camera.position.x * 1e6) / 1e6, 10);
  controls.dispose();
});
