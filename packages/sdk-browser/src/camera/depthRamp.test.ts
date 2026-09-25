// The depth material's ramp (#365): planes at the near plane, mid-way and the far plane read 1,
// 0.5 and 0 on both GPU paths, whatever the depth buffer holds. The WebGPU resolve applies the
// weights to a pixel's clip coordinates (`../visibility/shader/shadeWgsl.ts`); the WebGL2
// fragment to its view distance (`../webgl/cluster/shaders.ts`). Both expressions are read out
// of the shipped shader text and evaluated here, so a shader edit is what the test sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDepthRamp } from './depthConvention.ts';
import { SURFACE_MODEL } from '../scene/surfaceModel.ts';
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts';
import { SHADE_DECL_WGSL } from '../visibility/shader/shadeDeclWgsl.ts';
import { DEPTH_RAMP_WORD, SHADE_UNIFORM_WORDS } from '../visibility/shader/request.ts';
import { CLUSTER_FRAGMENT } from '../webgl/cluster/shaders.ts';
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

/** The ramp expression of a shader, the text between `clamp(` and `,0.0,1.0)` on its line. */
function rampExpression(source: string, line: RegExp) {
  const found = source.match(line);
  assert.ok(found, `no depth line matching ${line}`);
  return found[1];
}

const wgsl = rampExpression(
  SHADE_SHADER,
  new RegExp(
    `if\\(model==${SURFACE_MODEL.depth}u\\)\\{.*?rgb=vec3f\\(clamp\\((.*?),0\\.0,1\\.0\\)\\);\\}`,
  ),
);
/** The WebGPU resolve's line, `clamp(a·w + b + c·z/w)`, over the pixel's interpolated clip z, w. */
const resolveOf = new Function(
  'r',
  'w',
  'z',
  `return ${wgsl.replace('dot(bary,vec3f(c0.z,c1.z,c2.z))', 'z')};`,
) as (r: { x: number; y: number; z: number }, w: number, z: number) => number;
function resolveRamp(weights: Float32Array, clip: { z: number; w: number }) {
  const [x, y, z] = weights;
  return Math.min(1, Math.max(0, resolveOf({ x, y, z }, clip.w, clip.z)));
}

const glsl = rampExpression(
  CLUSTER_FRAGMENT,
  /if\(depthShaded\)rgb=vec3\(clamp\((.*?),0\.0,1\.0\)\);/,
);
/** The WebGL2 fragment's line, on its view distance `toEye.z`. */
const fragmentOf = new Function('depthRamp', 'toEye', `return ${glsl};`) as (
  depthRamp: { x: number; y: number },
  toEye: { z: number },
) => number;
function fragmentRamp(weights: Float32Array, distance: number) {
  const value = fragmentOf({ x: weights[0], y: weights[1] }, { z: distance });
  return Math.min(1, Math.max(0, value));
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
    DISTANCES.map((d) => fragmentRamp(weights, d)),
    'webgl2',
  );
});

test('The weights land at the offset they are given, nothing around them', () => {
  const words = new Float32Array(6).fill(7);
  writeDepthRamp(words, 2, NEAR, FAR, 1);
  assert.deepEqual([words[0], words[1], words[5]], [7, 7, 7]);
  assert.equal(words[4], 0, 'no clip-z weight under a perspective projection');
});

test('The resolve uniform: the ramp is a vec4f right before the sun, 16-byte aligned', () => {
  assert.match(SHADE_DECL_WGSL, /pixelScale:f32,depthRamp:vec4f,sun:ShadeSun,\}/);
  // viewProj 16 words, viewport 4, four scalars: the ramp starts at word 24, the sun at 28.
  assert.equal(DEPTH_RAMP_WORD, 16 + 4 + 4);
  assert.equal(DEPTH_RAMP_WORD % 4, 0);
  assert.equal(SHADE_UNIFORM_WORDS, DEPTH_RAMP_WORD + 4 + 16);
});
