// The depth material's ramp (#365): planes at the near plane, mid-way and the far plane read 1,
// 0.5 and 0 on both GPU paths, whatever the depth buffer holds. The WebGPU resolve applies the
// weights to a pixel's clip coordinates (`../visibility/shader/shadeWgsl.ts`); the WebGL2
// fragment to its view distance (`../webgl/cluster/shaders.ts`). Both are replayed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDepthRamp } from './depthConvention.ts';
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../sdk-core/src/math/primitives/camera.ts';

const NEAR = 0.1,
  FAR = 100,
  DISTANCES = [NEAR, (NEAR + FAR) / 2, FAR],
  EXPECTED = [1, 0.5, 0];

/** Clip `z` and `w` of the point `distance` ahead of the eye, on the view axis. */
function clipOf(projection: Float64Array, distance: number) {
  const z = -distance;
  return { z: projection[10] * z + projection[14], w: projection[11] * z + projection[15] };
}

/** The WebGPU resolve's formula, `clamp(a·w + b + c·z/w)`. */
function resolveRamp(weights: Float32Array, { z, w }: { z: number; w: number }) {
  return Math.min(1, Math.max(0, weights[0] * w + weights[1] + (weights[2] * z) / w));
}

const close = (actual: number[], label: string) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - EXPECTED[i]) < 1e-5, `${label}: ${value}`),
  );

test('WebGPU, perspective: the reversed depth still shows white near, black far', () => {
  const projection = perspectiveProjection(new Float64Array(16), 50, 1, NEAR, 1);
  const weights = writeDepthRamp(new Float32Array(3), 0, NEAR, FAR, 1);
  close(
    DISTANCES.map((d) => resolveRamp(weights, clipOf(projection, d))),
    'perspective',
  );
});

test('WebGPU, orthographic: the same ramp from the affine depth', () => {
  const projection = orthographicProjection(new Float64Array(16), -1, 1, -1, 1, NEAR, FAR);
  const weights = writeDepthRamp(new Float32Array(3), 0, NEAR, FAR, 0);
  close(
    DISTANCES.map((d) => resolveRamp(weights, clipOf(projection, d))),
    'orthographic',
  );
});

test('WebGL2: the view distance under the perspective weights gives the same ramp', () => {
  const weights = writeDepthRamp(new Float32Array(3), 0, NEAR, FAR, 1);
  close(
    DISTANCES.map((d) => Math.min(1, Math.max(0, weights[0] * d + weights[1]))),
    'webgl2',
  );
});

test('The weights land at the offset they are given, nothing around them', () => {
  const words = new Float32Array(6).fill(7);
  writeDepthRamp(words, 2, NEAR, FAR, 1);
  assert.deepEqual([words[0], words[1], words[5]], [7, 7, 7]);
  assert.equal(words[4], 0, 'no clip-z weight under a perspective projection');
});
