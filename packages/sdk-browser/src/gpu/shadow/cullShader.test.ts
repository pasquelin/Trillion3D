// #525: a sun page draws only the casters its own box meets. The shader cannot run under node: the
// test restates its box test in TypeScript, and pins the shader's text it restates, so the two
// cannot drift apart silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { dotVector3 } from '../../../../sdk-core/src/math/primitives/vector.ts';
import { writeSunSquare } from '../../../../sdk-core/src/scene/light-shadow/sunFaces.ts';
import { sunPageMetres } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { sunScene } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';

/** The volume's fields, in the floats the host writes (`SHADOW_CULL_FLOATS`), and the box test
 *  `keepCaster` runs on them: the lines `keeps` restates. */
const SHADER_BOX = [
  'struct Face{center:vec3f,far:f32,axis:vec3f,halfAngle:f32,right:vec3f,halfU:f32,up:vec3f,halfV:f32,',
  'let local=abs(vec3f(dot(delta,volume.right),dot(delta,volume.up),dot(delta,volume.axis)));',
  'let gap=max(local-vec3f(volume.halfU,volume.halfV,volume.far),vec3f(0.0));',
  'if(dot(gap,gap)>sphere.radius*sphere.radius){return;}',
];

/** `keepCaster`'s test of a caster's sphere against a sun page's box, restated: the floats of
 *  `right`, `up` and `axis` (8, 12, 4) against `halfU`, `halfV` and `far` (11, 15, 3). */
function keeps(volume: Float32Array, center: number[], radius: number) {
  const delta = [0, 1, 2].map((a) => center[a] - volume[a]);
  const dot = (at: number) => Math.abs(dotVector3(delta, volume, 0, at));
  const gaps = [dot(8) - volume[11], dot(12) - volume[15], dot(4) - volume[3]];
  return gaps.reduce((sum, gap) => sum + Math.max(0, gap) ** 2, 0) <= radius * radius;
}

test('both cull entries run the box test this file restates', () => {
  for (const shader of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER])
    for (const line of SHADER_BOX) assert.ok(shader.includes(line), line);
});

test("a caster outside a page's square is not drawn into it; one reaching it is", () => {
  const { plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    size = sunPageMetres(level);
  const volume = new Float32Array(SHADOW_CULL_FLOATS);
  writeSunSquare(new Float32Array(16), 0, volume, 0, plan.sun, slice, level, 3, 2);
  const right = plan.sun.frame.subarray(slice * 9, slice * 9 + 3);
  const beside = (pages: number) => [0, 1, 2].map((a) => volume[a] + right[a] * pages * size);
  assert.ok(keeps(volume, beside(0), 0.1 * size), 'a caster inside the page');
  assert.ok(!keeps(volume, beside(1), 0.3 * size), 'a caster over the next page');
  assert.ok(keeps(volume, beside(0.7), 0.3 * size), 'a caster reaching over its edge');
});
