import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { canvasRay } from './worldRaycast.ts';

test('a canvas point aims at the shape the frame is drawn at, not the CSS box', () => {
  const camera = new Camera('perspective', { fov: 50 });
  // A square CSS box whose drawing buffer is twice as wide: the frame is drawn at 2 : 1.
  const canvas = { clientWidth: 400, clientHeight: 400, width: 800, height: 400 };
  const ray = canvasRay(camera, canvas as HTMLCanvasElement, { x: 400, y: 200 });
  const edge = camera.rayThrough(1, 0, 2);
  assert.ok(ray.direction.distanceTo(edge.direction) < 1e-12);
});
