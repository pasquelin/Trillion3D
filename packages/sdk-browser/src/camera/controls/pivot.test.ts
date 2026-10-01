import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { fixtureSurface } from './controls.fixture.ts';
import { createPivotControls } from './pivot.ts';

test('orthographic gestures move projected pixels at every zoom and preserve the depth interval', () => {
  const surface = fixtureSurface(600);
  const camera = new Camera('orthographic', { left: -12, right: 12, top: 12, bottom: -12 });
  camera.position.z = 30;
  const controls = createPivotControls(camera, surface.element);
  const screen = () => {
    const point = new Vector3(2, 3, 0).sub(camera.position).applyMatrix4(camera.projectionMatrix);
    return [(point.x + 1) * 300, (1 - point.y) * 300];
  };
  for (const zoom of [0.7, 1, 3]) {
    camera.zoom = zoom;
    const before = screen();
    controls.panBy(37, -23);
    const after = screen();
    assert.ok(Math.abs(after[0] - before[0] - 37) < 1e-9);
    assert.ok(Math.abs(after[1] - before[1] + 23) < 1e-9);
  }
  const position = camera.position.toArray(),
    near = camera.near,
    far = camera.far;
  controls.api.minZoom = 0.6;
  controls.api.maxZoom = 8;
  let changes = 0,
    projectionWrites = 0;
  const updateProjection = camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix = () => {
    projectionWrites++;
    updateProjection();
  };
  controls.api.addEventListener('change', () => changes++);
  controls.dolly(1000);
  assert.equal(camera.zoom, 8);
  const count = changes,
    writes = projectionWrites;
  controls.dolly(1000);
  assert.equal(changes, count, 'a clamped gesture does not schedule another frame');
  assert.equal(
    projectionWrites,
    writes,
    'clamping does not temporarily publish an out-of-range zoom',
  );
  controls.dolly(-1000);
  assert.equal(camera.zoom, 0.6);
  assert.deepEqual(camera.position.toArray(), position, 'zoom never dollies through the subject');
  assert.equal(camera.near, near);
  assert.equal(camera.far, far);
  controls.api.dispose();
});

test('orthographic pans follow screen pixels on rectangular views with fixed or fitted aspect', () => {
  for (const fitAspect of [false, true]) {
    const surface = fixtureSurface(600);
    Object.defineProperty(surface.element, 'clientWidth', { value: 1200 });
    const camera = new Camera('orthographic', {
      left: -12,
      right: 12,
      top: 12,
      bottom: -12,
      aspect: 2,
      fitAspect,
    });
    camera.position.z = 30;
    camera.zoom = 2.3;
    const controls = createPivotControls(camera, surface.element);
    const screen = () => {
      const point = new Vector3(2, 3, 0).sub(camera.position).applyMatrix4(camera.projectionMatrix);
      return [(point.x + 1) * 600, (1 - point.y) * 300];
    };
    const before = screen();
    controls.panBy(37, -23);
    const after = screen();
    assert.ok(Math.abs(after[0] - before[0] - 37) < 1e-9);
    assert.ok(Math.abs(after[1] - before[1] + 23) < 1e-9);
    controls.api.dispose();
  }
});
