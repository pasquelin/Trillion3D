// `keepCaster`'s test of a caster's sphere against a sun page's box, restated in TypeScript — the
// shader cannot run under node —, with the shader lines it restates, which the cull's test pins so
// the two cannot drift apart silently (#525, #1211).
import { dotVector3 } from '../../../../sdk-core/src/math/primitives/vector.ts';

/** The volume's fields, in the floats the host writes (`SHADOW_CULL_FLOATS`), and the box test
 *  `keepCaster` runs on them: the lines `keeps` restates. */
export const SHADER_BOX = [
  'struct Face{center:vec3f,far:f32,axis:vec3f,halfAngle:f32,right:vec3f,halfU:f32,up:vec3f,halfV:f32,',
  'let local=abs(vec3f(dot(delta,volume.right),dot(delta,volume.up),dot(delta,volume.axis)));',
  'let gap=max(local-vec3f(volume.halfU,volume.halfV,volume.far),vec3f(0.0));',
  'if(dot(gap,gap)>sphere.radius*sphere.radius){return false;}',
];

/** `keepCaster`'s test of a caster's sphere against a sun page's box, restated: the floats of
 *  `right`, `up` and `axis` (8, 12, 4) against `halfU`, `halfV` and `far` (11, 15, 3). */
export function keeps(volume: Float32Array, center: ArrayLike<number>, radius: number) {
  const delta = [0, 1, 2].map((a) => center[a] - volume[a]);
  const dot = (at: number) => Math.abs(dotVector3(delta, volume, 0, at));
  const gaps = [dot(8) - volume[11], dot(12) - volume[15], dot(4) - volume[3]];
  return gaps.reduce((sum, gap) => sum + Math.max(0, gap) ** 2, 0) <= radius * radius;
}
