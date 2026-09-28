import test from 'node:test';
import assert from 'node:assert/strict';
import { screenTraceShader } from './traceShader.ts';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { SCREEN_REFLECTION_WGSL } from './screenWgsl.ts';
import { SCREEN_REFLECTION_GLSL } from './screenGlsl.ts';

const source = functionText(screenTraceShader('wgsl'), 'reflectionExit');
const clip = new Function(
  'c',
  'd',
  'const min=Math.min;' + source.slice(source.indexOf('{') + 1).replace(/var (\w+):\w+/g, 'let $1'),
) as (c: Record<string, number>, d: Record<string, number>) => number;

test('homogeneous clipping keeps near/far and viewport exits valid before perspective division', () => {
  for (const [c, d, exit] of [
    [{ x: 0, y: 0, z: 0.5, w: 1 }, { x: 1, y: 0, z: 0, w: 0 }, 1],
    [{ x: 0, y: 0, z: 0.5, w: 1 }, { x: 0, y: -2, z: 0, w: 0 }, 0.5],
    [{ x: 0, y: 0, z: 0.5, w: 1 }, { x: 0, y: 0, z: 1, w: 0 }, 0.5],
    [{ x: 0, y: 0, z: 0.5, w: 1 }, { x: 0, y: 0, z: -1, w: 0 }, 0.5],
    // Perspective ray towards the eye clips at z=w before w reaches zero.
    [{ x: 0, y: 0, z: 0.5, w: 2 }, { x: 0, y: 0, z: 0.5, w: -1 }, 1],
    // Infinite-far reverse-depth projection: w grows; the ray exits through x=w.
    [{ x: 0, y: 0, z: 1, w: 2 }, { x: 2, y: 0, z: 0, w: 1 }, 2],
  ] as const) {
    const t = clip(c, d);
    assert.equal(t, exit);
    const e = { x: c.x + d.x * t, y: c.y + d.y * t, z: c.z + d.z * t, w: c.w + d.w * t };
    assert.ok(e.w > 0 && Math.abs(e.x) <= e.w && Math.abs(e.y) <= e.w && e.z >= 0 && e.z <= e.w);
  }
  assert.equal(clip({ x: 2, y: 0, z: 0.5, w: 1 }, { x: -1, y: 0, z: 0, w: 0 }), 0);
});

test('API projection adapters use opposite texture Y and normalize OpenGL clip depth', () => {
  assert.match(SCREEN_REFLECTION_WGSL, /vec4f\(c.x,-c.y,c.z,c.w\)/);
  assert.match(SCREEN_REFLECTION_GLSL, /c.z=\(c.z\+c.w\)\*0.5/);
  assert.match(SCREEN_REFLECTION_WGSL, /reflectionClearDepth\(\)->f32\{return 0.0;/);
  assert.match(SCREEN_REFLECTION_GLSL, /reflectionClearDepth\(\)\{return 1.0;/);
});
