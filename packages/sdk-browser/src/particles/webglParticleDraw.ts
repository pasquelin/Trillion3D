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
import { DISC_CORNERS, DRAW_FLOATS, drawOrder, writeDrawWords } from './drawWords.ts';
import { refuseAll, usedSlots } from './poolStates.ts';

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
  vec2 size = vec2(textureSize(sceneDepth, 0));
  vec4 scene = m[1] * vec4(gl_FragCoord.xy / size * 2. - 1., d * 2. - 1., 1.);
  float behind = distance(scene.xyz / scene.w, look[0].xyz) - distance(local, look[0].xyz);
  float soft = abs(scene.w) > 1e-20 ? clamp(behind / look[2].x, 0., 1.) : 1.;
  float k = clamp(1. - dot(corner, corner), 0., 1.) * soft * life * look[1].a;
  vec3 shown = linearOut ? look[1].rgb : linearToSrgb(toneMap(look[1].rgb));
  fragColor = vec4(shown, 1.) * k; untoned = vec4(0., 0., 0., k); // toned, blended as the colour
}`;

/** The WebGL2 particle draw over the host's image, its depth copied for the soft edge; a depth
 *  it cannot copy returns `PARTICLES_UNSUPPORTED` once, the pools refused, never drawn. */
export function createWebglParticleDraw(
  gl: WebGL2RenderingContext,
  texels: number,
  stateOf: (pool: ParticlePool) => WebGLTexture | undefined,
) {
  const words = new Float32Array(DRAW_FLOATS),
    [matrices, look] = [words.subarray(0, 32), words.subarray(32, 44)],
    screen = new Float64Array(16),
    eye = new Float64Array(3),
    order: ParticlePool[] = [];
  const held = boundToContext(
    gl,
    () => {
      const program = createWebglProgram(gl, vertex(texels), FRAGMENT);
      const at = (name: string) => gl.getUniformLocation(program, name);
      const names = ['m', 'look', 'linearOut', 'toneCurve', 'sceneDepth'],
        [m, look, linear, curve, depth] = names.map(at),
        uniforms = { m, look, linear, curve, depth },
        vao = gl.createVertexArray()!;
      const copy = { framebuffer: gl.createFramebuffer()!, texture: gl.createTexture()! };
      bindWebglTexture(gl, 1, copy.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, copy.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, copy.texture, 0);
      const checked = undefined as WebGLFramebuffer | null | undefined;
      return { program, vao, uniforms, copy, checked, width: 0, height: 0, refused: false };
    },
    ({ program, vao, copy }) => {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(copy.texture);
      gl.deleteFramebuffer(copy.framebuffer);
    },
  );
  return {
    /** Draws `pools` into `output` seen by `camera`; returns the draws made, or the refusal. */
    draw(pools: readonly ParticlePool[], camera: HostDrawCamera, output: HostDrawOutput) {
      const live = held.current();
      // The eye in double precision, the world matrix's: the host's 32-bit eye rounds 10 km out.
      for (let i = 0; i < 3; i++) eye[i] = camera.world[12 + i];
      if (!live || !drawOrder(pools, eye, order).length) return 0;
      if (live.refused) return (refuseAll(order), 0);
      const { framebuffer, width, height } = output;
      if (live.width !== width || live.height !== height) {
        bindWebglTexture(gl, 1, live.copy.texture);
        const { TEXTURE_2D: T, DEPTH_COMPONENT: D } = gl;
        gl.texImage2D(T, 0, gl.DEPTH_COMPONENT24, width, height, 0, D, gl.UNSIGNED_INT, null);
        [live.width, live.height] = [width, height];
      }
      gl.disable(gl.SCISSOR_TEST);
      // The depth copied for the soft edge; a framebuffer's first copy, older errors cleared, asks.
      for (let n = 0; live.checked !== framebuffer && n < 8 && gl.getError() !== gl.NO_ERROR; n++);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, live.copy.framebuffer);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (live.checked !== framebuffer && gl.getError() === gl.INVALID_OPERATION) {
        live.refused = refuseAll(order);
        return new Error('PARTICLES_UNSUPPORTED: WebGL2 particles fade on a depth it cannot copy');
      }
      live.checked = framebuffer;
      multiplyMatrix4Typed(screen, camera.projection, camera.view);
      gl.useProgram(live.program);
      gl.bindVertexArray(live.vao);
      gl.viewport(0, 0, width, height);
      gl.uniform1i(live.uniforms.depth, 1); // the state samples unit 0, where samplers start
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
        if (pool.blend === 'premultiplied') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
        bindWebglTexture(gl, 0, state);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, usedSlots(pool));
        draws++;
      }
      // Nothing is left for the next pass to sample into a feedback loop, blend or not write.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(null);
      gl.useProgram(null);
      return draws;
    },
    refused: () => held.alive() && !!held.current()?.refused,
    dispose: held.dispose,
  };
}
