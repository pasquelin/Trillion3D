import test from 'node:test';
import assert from 'node:assert/strict';
import { xrCellReach } from './reach.ts';
import { createEngineCamera } from '../../camera/world.ts';

test('partition residency encloses both asymmetric eye frustums with one spatial query', () => {
  const views = [-0.04, 0.04].map((x, i) => {
    const camera = createEngineCamera();
    camera.eye[0] = x;
    camera.eye[1] = 1.6;
    camera.eye[2] = -20;
    camera.far = 50;
    camera.projection[0] = 1.2;
    camera.projection[5] = 1.4;
    camera.projection[8] = i ? 0.3 : -0.2;
    camera.projection[9] = 0.1;
    return { camera, viewport: [1200, 1000] as [number, number] };
  });
  const result = xrCellReach(views);
  assert.deepEqual(result.eye, [0, 1.6, -20]);
  for (const { camera } of views)
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        const p = camera.projection;
        const corner = [
          camera.eye[0] + (camera.far * (x + p[8])) / p[0],
          camera.eye[1] + (camera.far * (y + p[9])) / p[5],
          camera.eye[2] - camera.far,
        ];
        assert.ok(Math.hypot(...corner.map((n, i) => n - result.eye[i])) <= result.reach);
      }
});
