import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { multiplyMatrix4Typed } from '../../../sdk-core/src/math/matrix/matrix4Typed.ts';
import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../sdk-core/src/scene/core/environment.ts';
import type { HostDrawCamera } from '../camera/world.ts';
import { boundToContext } from '../webgl/core/contextBound.ts';
import { OUTPUT_TRANSFER_GLSL } from '../webgl/core/outputGlsl.ts';
import { createWebglProgram } from '../webgl/core/program.ts';
import { bindWebglTexture, type HostDrawOutput } from '../webgl/core/renderTarget.ts';
import { glBlendEnums } from '../webgl/cluster/state.ts';
import { BLENDS, DISC_CORNERS, DRAW_FLOATS, drawOrder, writeDrawWords } from './drawWords.ts';
import { usedSlots } from './poolStates.ts';

/** The WGSL draw (`webgpuParticleDraw.ts`) texel by texel, `texels` a row. `m` holds the draw
 *  words' two matrices and `look` the rest: eye and size, colour, softness. */
const vertex = (texels: number) => `#version 300 es
precision highp float;
uniform highp sampler2D state;
uniform mat4 m[2];
uniform vec4 look[3];
const vec2 corners[6] = vec2[6](${DISC_CORNERS});
out vec2 corner; out vec3 local; out float life;
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
}`;

/** Linear radiance for the effect chain, otherwise through the engine's display chain. */
const FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D sceneDepth;
uniform mat4 m[2];
uniform vec4 look[3];
uniform bool linearOut;
in vec2 corner; in vec3 local; in float life;
layout(location = 0) out vec4 fragColor; layout(location = 1) out vec4 untoned;
${OUTPUT_TRANSFER_GLSL}
void main() {
  float d = texelFetch(sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
  vec4 scene = m[1] * vec4(gl_FragCoord.xy / vec2(textureSize(sceneDepth, 0)) * 2. - 1., d * 2. - 1., 1.);
  float behind = distance(scene.xyz / scene.w, look[0].xyz) - distance(local, look[0].xyz);
  float soft = abs(scene.w) > 1e-20 ? clamp(behind / look[2].x, 0., 1.) : 1.;
  float k = clamp(1. - dot(corner, corner), 0., 1.) * soft * life * look[1].a;
  vec3 shown = linearOut ? look[1].rgb : linearToSrgb(toneMap(look[1].rgb));
  fragColor = vec4(shown, 1.) * k; untoned = vec4(0., 0., 0., k); // toned, blended as the colour
}`;

/** The copy's depth formats: packed with stencil first, as browsers often keep a drawing buffer's
 *  depth even unasked; a blit is refused between two formats, so the copy takes the one allowed. */
const DEPTHS = [
  ['DEPTH24_STENCIL8', 'DEPTH_STENCIL', 'UNSIGNED_INT_24_8', 'DEPTH_STENCIL_ATTACHMENT'],
  ['DEPTH_COMPONENT24', 'DEPTH_COMPONENT', 'UNSIGNED_INT', 'DEPTH_ATTACHMENT'],
] as const;

/** The WebGL2 particle draw over the host's image, its depth copied for the soft edge: `additive`
 *  in any order, `premultiplied` far to near by emitter (`drawOrder`). A depth it cannot copy
 *  refuses the pools, `refused` hearing `PARTICLES_UNSUPPORTED` once: never drawn hard-edged. */
export function createWebglParticleDraw(
  gl: WebGL2RenderingContext,
  texels: number,
  stateOf: (pool: ParticlePool) => WebGLTexture | undefined,
  refused: (reason: string) => void,
) {
  const words = new Float32Array(DRAW_FLOATS),
    matrices = words.subarray(0, 32),
    look = words.subarray(32, 44),
    screen = new Float64Array(16),
    eye = new Float64Array(3),
    order: ParticlePool[] = [],
    blendEnum = glBlendEnums(gl);
  const held = boundToContext(
    gl,
    () => {
      const program = createWebglProgram(gl, vertex(texels), FRAGMENT);
      const at = (name: string) => gl.getUniformLocation(program, name);
      const uniforms = {
        m: at('m'),
        look: at('look'),
        linear: at('linearOut'),
        curve: at('toneCurve'),
      };
      gl.useProgram(program);
      gl.uniform1i(at('sceneDepth'), 1); // the state samples unit 0, where samplers start
      gl.useProgram(null);
      const copy = { framebuffer: gl.createFramebuffer()!, texture: gl.createTexture()! };
      bindWebglTexture(gl, 1, copy.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      /** The depth format each framebuffer's blit took, found on its first copy. */
      const formats = new Map<WebGLFramebuffer | null, number>();
      const vao = gl.createVertexArray()!;
      return { program, vao, uniforms, copy, formats, at: -1, width: 0, height: 0, refused: false };
    },
    ({ program, vao, copy }) => {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(copy.texture);
      gl.deleteFramebuffer(copy.framebuffer);
    },
  );
  type Live = NonNullable<ReturnType<typeof held.current>>;
  /** Copies the bound read framebuffer's depth into the copy made in format `at`, remade when
   *  its format or size changed; true unless the blit was refused. */
  const copyDepth = (live: Live, at: number, width: number, height: number, probing: boolean) => {
    const { TEXTURE_2D: texture, DRAW_FRAMEBUFFER: draw } = gl;
    if (live.at !== at || live.width !== width || live.height !== height) {
      [live.at, live.width, live.height] = [at, width, height];
      const [internal, format, type, point] = DEPTHS[at];
      bindWebglTexture(gl, 1, live.copy.texture);
      gl.texImage2D(texture, 0, gl[internal], width, height, 0, gl[format], gl[type], null);
      gl.framebufferTexture2D(draw, gl.DEPTH_STENCIL_ATTACHMENT, texture, null, 0);
      gl.framebufferTexture2D(draw, gl[point], texture, live.copy.texture, 0);
    }
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    return !probing || gl.getError() !== gl.INVALID_OPERATION;
  };
  return {
    /** Draws `pools` into `output` seen by `camera`; returns the draws made. */
    draw(pools: readonly ParticlePool[], camera: HostDrawCamera, output: HostDrawOutput) {
      // The eye in double precision, the world matrix's: the host's 32-bit eye rounds 10 km out.
      for (let i = 0; i < 3; i++) eye[i] = camera.world[12 + i];
      if (!drawOrder(pools, eye, order).some((pool) => stateOf(pool))) return 0;
      const live = held.current();
      if (!live || live.refused) return 0; // a refused draw: the step keeps the pools refused
      const { framebuffer, width, height } = output,
        found = live.formats.get(framebuffer);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, live.copy.framebuffer);
      // The depth copied for the soft edge, same rectangles, resolved as they are. A framebuffer's
      // first copy, older errors cleared, probes each format in order until a blit is allowed.
      if (found !== undefined) copyDepth(live, found, width, height, false);
      else {
        for (let n = 0; n < 8 && gl.getError() !== gl.NO_ERROR; n++);
        const at = DEPTHS.findIndex((_, i) => copyDepth(live, i, width, height, true));
        if (at >= 0) live.formats.set(framebuffer, at);
        else live.refused = true;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (live.refused) {
        refused('PARTICLES_UNSUPPORTED: WebGL2 particles fade on a depth it cannot copy');
        return 0;
      }
      multiplyMatrix4Typed(screen, camera.projection, camera.view);
      gl.useProgram(live.program);
      gl.bindVertexArray(live.vao);
      gl.viewport(0, 0, width, height);
      gl.uniform1i(live.uniforms.linear, output.linear ? 1 : 0);
      const curve = output.toneMapped ? (output.toneMapping ?? DEFAULT_TONE_MAPPING) : 'none';
      gl.uniform1i(live.uniforms.curve, TONE_MAPPING_RANK[curve]);
      bindWebglTexture(gl, 1, live.copy.texture);
      gl.enable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST); // hidden fragments skipped; the soft edge fades the rest
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      let draws = 0;
      for (const pool of order) {
        const state = stateOf(pool);
        if (!state) continue;
        writeDrawWords(words, pool, screen, eye);
        gl.uniformMatrix4fv(live.uniforms.m, false, matrices);
        gl.uniform4fv(live.uniforms.look, look);
        const { color, alpha } = BLENDS[pool.blend];
        gl.blendFuncSeparate(
          blendEnum[color.srcFactor!],
          blendEnum[color.dstFactor!],
          blendEnum[alpha.srcFactor!],
          blendEnum[alpha.dstFactor!],
        );
        bindWebglTexture(gl, 0, state);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, usedSlots(pool));
        draws++;
      }
      // The state is unbound, its step's next target: no feedback loop, blend or depth left on.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(null);
      gl.useProgram(null);
      return draws;
    },
    refused: () => held.alive() && !!held.current()?.refused,
    /** Bytes of the frame's depth copy, 4 a texel in either format, none before the first. */
    bytes() {
      const live = held.alive() ? held.current() : undefined;
      return live ? live.width * live.height * 4 : 0;
    },
    dispose: held.dispose,
  };
}
