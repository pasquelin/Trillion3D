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
import { DRAW_FLOATS, drawOrder, writeDrawWords } from './drawWords.ts';
import { usedSlots } from './poolStates.ts';

/** The WGSL draw (`webgpuParticleDraw.ts`) texel by texel: a slot's two texels, `texels` a row. */
const vertex = (texels: number) => `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D state;
uniform mat4 clip;
uniform vec4 eyeSize;
out vec2 corner;
out vec3 local;
out float life;
void main() {
  int t = 2 * gl_InstanceID, v = gl_VertexID;
  ivec2 at = ivec2(t % ${texels}, t / ${texels});
  vec4 p = texelFetch(state, at, 0), w = texelFetch(state, at + ivec2(1, 0), 0);
  gl_Position = vec4(2., 2., 2., 1.);
  if (!(p.w < w.w)) return;
  corner = vec2(v == 1 || v >= 4 ? 1. : -1., v == 2 || v == 3 || v == 5 ? 1. : -1.);
  vec3 toEye = normalize(eyeSize.xyz - p.xyz);
  vec3 right = normalize(cross(abs(toEye.y) > .99 ? vec3(1., 0., 0.) : vec3(0., 1., 0.), toEye));
  local = p.xyz + (right * corner.x + cross(toEye, right) * corner.y) * eyeSize.w;
  gl_Position = clip * vec4(local, 1.);
  life = 1. - p.w / w.w;
}`;

/** The same fragment, written where the host composed its image: linear radiance for the
 *  effect chain, otherwise through the display chain every engine program writes by. */
const FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D sceneDepth;
uniform mat4 unclip;
uniform vec4 eyeSize;
uniform vec4 color;
uniform vec3 softSize;
uniform bool premultiplied;
uniform bool linearOut;
in vec2 corner;
in vec3 local;
in float life;
out vec4 fragColor;
${OUTPUT_TRANSFER_GLSL}
void main() {
  float d = texelFetch(sceneDepth, ivec2(gl_FragCoord.xy), 0).r;
  vec4 scene = unclip * vec4(gl_FragCoord.xy / softSize.yz * 2. - 1., d * 2. - 1., 1.);
  float behind = distance(scene.xyz / scene.w, eyeSize.xyz) - distance(local, eyeSize.xyz);
  float soft = abs(scene.w) > 1e-20 ? clamp(behind / softSize.x, 0., 1.) : 1.;
  float k = clamp(1. - dot(corner, corner), 0., 1.) * soft * life * color.a;
  vec3 shown = linearOut ? color.rgb : linearToSrgb(toneMap(color.rgb));
  fragColor = vec4(shown * k, premultiplied ? k : 0.);
}`;

/**
 * The WebGL2 particle draw, over the image the host composed: the frame's depth is first copied
 * into a depth texture the soft edge reads, then each pool with particles alive is one instanced
 * draw, far to near by origin, blended as the pool says, reading the step's latest target in
 * place (`stateOf`). A context that cannot copy the frame's depth draws no particle: it throws
 * `PARTICLES_UNSUPPORTED`, the pools refused, and never draws them with hard edges.
 */
export function createWebglParticleDraw(
  gl: WebGL2RenderingContext,
  texels: number,
  stateOf: (pool: ParticlePool) => WebGLTexture | undefined,
) {
  const words = new Float32Array(DRAW_FLOATS),
    screen = new Float64Array(16),
    eye = new Float64Array(3),
    order: ParticlePool[] = [];
  const [clipWords, unclipWords, eyeWords, colorWords] = [0, 16, 32, 36].map((at, n) =>
    words.subarray(at, at + (n < 2 ? 16 : 4)),
  );
  const held = boundToContext(
    gl,
    () => {
      const program = createWebglProgram(gl, vertex(texels), FRAGMENT);
      const at = (name: string) => gl.getUniformLocation(program, name);
      gl.useProgram(program);
      gl.uniform1i(at('state'), 0);
      gl.uniform1i(at('sceneDepth'), 1);
      gl.useProgram(null);
      const names = ['clip', 'unclip', 'eyeSize', 'color', 'softSize', 'premultiplied'] as const;
      const uniforms = Object.fromEntries(names.map((name) => [name, at(name)]));
      const depth = {
        texture: gl.createTexture()!,
        framebuffer: gl.createFramebuffer()!,
        w: 0,
        h: 0,
      };
      const outputs = { linear: at('linearOut'), curve: at('toneCurve') };
      return { program, vao: gl.createVertexArray()!, uniforms, outputs, depth, copied: false };
    },
    ({ program, vao, depth }) => {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(depth.texture);
      gl.deleteFramebuffer(depth.framebuffer);
    },
  );
  type Live = NonNullable<ReturnType<typeof held.current>>;
  /** Copies the depth of `output` into the draw's texture; false if the context refused it. */
  const copyDepth = (live: Live, { framebuffer, width, height }: HostDrawOutput) => {
    const { depth } = live;
    if (depth.w !== width || depth.h !== height) {
      gl.deleteTexture(depth.texture);
      depth.texture = gl.createTexture()!;
      bindWebglTexture(gl, 1, depth.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, depth.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.texture, 0);
      [depth.w, depth.h] = [width, height];
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, depth.framebuffer);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    // The first copy asks once whether the frame's depth format matched: never again per image.
    if (live.copied) return true;
    live.copied = gl.getError() !== gl.INVALID_OPERATION;
    return live.copied;
  };
  return {
    /** Draws `pools` into `output` seen by `camera`; returns the draws made. */
    draw(pools: readonly ParticlePool[], camera: HostDrawCamera, output: HostDrawOutput) {
      const live = held.current();
      // The eye in double precision, the world matrix's: the host's 32-bit eye rounds 10 km out.
      for (let i = 0; i < 3; i++) eye[i] = camera.world[12 + i];
      if (!live || !drawOrder(pools, eye, order).length) return 0;
      if (!copyDepth(live, output)) {
        for (const pool of pools) pool.refused = true;
        throw new Error(
          "PARTICLES_UNSUPPORTED: WebGL2 particles fade on the frame's depth, and this context " +
            'cannot copy it',
        );
      }
      const { uniforms: u, outputs } = live;
      multiplyMatrix4Typed(screen, camera.projection, camera.view);
      gl.useProgram(live.program);
      gl.bindVertexArray(live.vao);
      gl.viewport(0, 0, output.width, output.height);
      gl.uniform1i(outputs.linear, output.linear ? 1 : 0);
      const curve = output.toneMapped ? (output.toneMapping ?? DEFAULT_TONE_MAPPING) : 'none';
      gl.uniform1i(outputs.curve, TONE_MAPPING_RANK[curve]);
      bindWebglTexture(gl, 1, live.depth.texture);
      gl.enable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      for (const pool of order) {
        const state = stateOf(pool);
        if (!state) continue;
        writeDrawWords(words, pool, screen, eye);
        gl.uniformMatrix4fv(u.clip, false, clipWords);
        gl.uniformMatrix4fv(u.unclip, false, unclipWords);
        gl.uniform4fv(u.eyeSize, eyeWords);
        gl.uniform4fv(u.color, colorWords);
        gl.uniform3f(u.softSize, words[40], output.width, output.height);
        const premultiplied = pool.blend === 'premultiplied';
        gl.uniform1i(u.premultiplied, premultiplied ? 1 : 0);
        gl.blendFunc(gl.ONE, premultiplied ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
        bindWebglTexture(gl, 0, state);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, usedSlots(pool));
      }
      // Nothing is left for the next pass to sample into a feedback loop, blend or not write.
      for (const unit of [0, 1]) bindWebglTexture(gl, unit, null);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(null);
      gl.useProgram(null);
      return order.length;
    },
    dispose: held.dispose,
  };
}
