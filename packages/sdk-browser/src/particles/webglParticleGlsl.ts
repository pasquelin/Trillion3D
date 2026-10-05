// The WebGL2 particle draw's shaders (`webglParticleDraw.ts`), the WGSL draw's twin.
import { OUTPUT_TRANSFER_GLSL } from '../webgl/core/outputGlsl.ts';
import { DISC_CORNERS } from './drawWords.ts';

/** The WGSL draw (`webgpuParticleDraw.ts`) texel by texel, `texels` a row. `m` holds the draw
 *  words' two matrices and `look` the rest: eye and size, colour, softness. */
export const particleVertexGlsl = (texels: number) => `#version 300 es
precision highp float;
uniform highp sampler2D state;
uniform mat4 m[2];
uniform vec4 look[3];
uniform bool linearOut;
const vec2 corners[6] = vec2[6](${DISC_CORNERS});
out vec2 corner; out vec3 local; out float life; flat out vec3 shown;
${OUTPUT_TRANSFER_GLSL}
void main() {
  int t = 2 * gl_InstanceID, v = gl_VertexID;
  ivec2 at = ivec2(t % ${texels}, t / ${texels});
  vec4 p = texelFetch(state, at, 0), w = texelFetch(state, at + ivec2(1, 0), 0);
  gl_Position = vec4(2., 2., 2., 1.);
  if (!(p.w < w.w)) return;
  corner = corners[v];
  vec3 toEye = normalize(look[0].xyz - p.xyz);
  vec3 right = normalize(cross(abs(toEye.y) > .99 ? vec3(1., 0., 0.) : vec3(0., 1., 0.), toEye));
  local = p.xyz + (right * corner.x + cross(toEye, right) * corner.y) * look[0].w;
  gl_Position = m[0] * vec4(local, 1.);
  life = 1. - p.w / w.w;
  shown = linearOut ? look[1].rgb : linearToSrgb(toneMap(look[1].rgb));
}`;

/** The colour `shown` comes from the vertex stage, flat: linear radiance for the effect chain,
 *  otherwise through the engine's display chain, once per vertex rather than per fragment. Both
 *  stages are `highp`, so it is the same value; `toneCurve` lives in the vertex stage alone, as an
 *  `int` uniform's default precision differs between the stages and would fail the link. */
export const PARTICLE_FRAGMENT_GLSL = `#version 300 es
precision highp float;
uniform highp sampler2D sceneDepth;
uniform mat4 m[2];
uniform vec4 look[3];
in vec2 corner; in vec3 local; in float life; flat in vec3 shown;
layout(location = 0) out vec4 fragColor; layout(location = 1) out vec4 untoned;
void main() {
  float d = texelFetch(sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
  vec4 scene = m[1] * vec4(gl_FragCoord.xy / vec2(textureSize(sceneDepth, 0)) * 2. - 1., d * 2. - 1., 1.);
  float behind = distance(scene.xyz / scene.w, look[0].xyz) - distance(local, look[0].xyz);
  float soft = abs(scene.w) > 1e-20 ? clamp(behind / look[2].x, 0., 1.) : 1.;
  float k = clamp(1. - dot(corner, corner), 0., 1.) * soft * life * look[1].a;
  fragColor = vec4(shown, 1.) * k; untoned = vec4(0., 0., 0., k); // toned, blended as the colour
}`;
