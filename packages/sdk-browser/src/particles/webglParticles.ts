import { PARTICLE_FLOATS, type ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { boundToContext } from '../webgl/core/contextBound.ts';
import { FULLSCREEN_VERTEX, setFullscreenPassState } from '../webgl/core/fullscreenPass.ts';
import { createWebglProgram } from '../webgl/core/program.ts';
import {
  bindWebglTexture,
  createWebglRenderTarget,
  halfFloatTargets,
  type WebglRenderTarget,
} from '../webgl/core/renderTarget.ts';
import { createPoolStates, usedSlots } from './poolStates.ts';

/** Particles per texture row, two texels each: position and age, then velocity and lifetime. */
export const PARTICLE_ROW = 512;
const TEXELS = 2 * PARTICLE_ROW;

/** One fragment per texel: the slot's particle, or the record the ring gives it this image,
 *  moved when alive; the half of it this texel holds is written. The WGSL step, texel by texel,
 *  its positions counted from the pool's origin like WebGPU's. */
const PARTICLES_GLSL = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D state;
uniform highp sampler2D staged;
uniform vec4 uStep;
uniform ivec3 uRing;
out vec4 color;
vec4 texel(highp sampler2D from, int t) {
  return texelFetch(from, ivec2(t % ${TEXELS}, t / ${TEXELS}), 0);
}
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  int t = at.y * ${TEXELS} + at.x, i = t >> 1;
  if (i >= uRing.z) { color = vec4(0.); return; }
  int k = (i + uRing.z - uRing.x) % uRing.z;
  bool born = k < uRing.y;
  vec4 p = born ? texel(staged, 2 * k) : texel(state, 2 * i);
  vec4 v = born ? texel(staged, 2 * k + 1) : texel(state, 2 * i + 1);
  if (p.w < v.w) { v.xyz += uStep.xyz * uStep.w; p.xyz += v.xyz * uStep.w; p.w += uStep.w; }
  color = (t & 1) == 0 ? p : v;
}`;

type PoolState = { targets: [WebglRenderTarget, WebglRenderTarget]; staged: WebGLTexture };

/**
 * The WebGL2 particle step: each pool's state in two half-float targets drawn in turn by one
 * full-screen pass over the rows its emitted slots fill, which reads the other target and the
 * pool's staged records, uploaded as 32-bit float texels up to the image's count. A pool's
 * targets are made the first time it moves, given back the image after the world lets it go,
 * and rebuilt after a lost context. A context that renders no half float refuses every pool by
 * name: the ping-pong has no other target. The pass leaves no framebuffer, program or vertex
 * array bound.
 */
export function createWebglParticles(gl: WebGL2RenderingContext) {
  const supported = halfFloatTargets(gl);
  /** Each pool's targets, made on the live context and lost with it. */
  const poolStates = () =>
    createPoolStates<PoolState>(
      (pool) => {
        const rows = Math.ceil(pool.capacity / PARTICLE_ROW),
          target = () => createWebglRenderTarget(gl, TEXELS, rows, { depth: false, hdr: true });
        const staged = gl.createTexture()!;
        bindWebglTexture(gl, 1, staged);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const stagedRows = Math.ceil(pool.emitPerFrame / PARTICLE_ROW);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEXELS, stagedRows, 0, gl.RGBA, gl.FLOAT, null);
        return { targets: [target(), target()], staged };
      },
      ({ targets, staged }) => {
        for (const target of targets) target.dispose();
        gl.deleteTexture(staged);
      },
    );
  const held = boundToContext(
    gl,
    () => {
      // A restored context starts with no extension enabled: the targets need it again.
      halfFloatTargets(gl);
      const program = createWebglProgram(gl, FULLSCREEN_VERTEX, PARTICLES_GLSL);
      const at = (name: string) => gl.getUniformLocation(program, name);
      gl.useProgram(program);
      gl.uniform1i(at('state'), 0);
      gl.uniform1i(at('staged'), 1);
      gl.useProgram(null);
      const vao = gl.createVertexArray()!;
      return { program, vao, step: at('uStep'), ring: at('uRing'), made: poolStates() };
    },
    ({ program, vao, made }) => {
      made.dispose();
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  );
  /** Uploads the image's `count` records from the pool's staging: whole rows, then the rest. */
  const upload = (pool: ParticlePool, count: number) => {
    const full = Math.floor(count / PARTICLE_ROW),
      rest = count % PARTICLE_ROW,
      { FLOAT, RGBA, TEXTURE_2D } = gl;
    // Records as they are: an image texture's upload may have left flipping or premultiplying on.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (full) gl.texSubImage2D(TEXTURE_2D, 0, 0, 0, TEXELS, full, RGBA, FLOAT, pool.staging, 0);
    if (rest) {
      const from = full * PARTICLE_ROW * PARTICLE_FLOATS;
      gl.texSubImage2D(TEXTURE_2D, 0, 0, full, 2 * rest, 1, RGBA, FLOAT, pool.staging, from);
    }
  };
  return {
    /** Steps `pools`; returns the draws made. Throws `PARTICLES_UNSUPPORTED`, the pools refused,
     *  on a context without half-float targets. */
    run(pools: readonly ParticlePool[]) {
      if (!supported) {
        for (const pool of pools) pool.refused = true; // it asks no frame of its own
        if (!pools.length) return 0;
        throw new Error(
          'PARTICLES_UNSUPPORTED: WebGL2 particles render half floats, and this context grants ' +
            'neither EXT_color_buffer_half_float nor EXT_color_buffer_float',
        );
      }
      const live = held.current();
      if (!live) return 0;
      let draws = 0;
      for (const pool of pools) {
        const { first, count, dt } = pool.flush();
        if (!count && !dt) continue;
        const { targets, staged } = live.made.of(pool);
        if (!draws++) {
          setFullscreenPassState(gl);
          gl.useProgram(live.program);
          gl.bindVertexArray(live.vao);
        }
        bindWebglTexture(gl, 1, staged);
        if (count) upload(pool, count);
        // Read the last state, write the other target over the rows emitted into; then swap.
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1].framebuffer);
        gl.viewport(0, 0, TEXELS, Math.ceil(usedSlots(pool) / PARTICLE_ROW));
        bindWebglTexture(gl, 0, targets[0].texture);
        const a = pool.acceleration;
        gl.uniform4f(live.step, a[0], a[1], a[2], dt);
        gl.uniform3i(live.ring, first, count, pool.capacity);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        targets.reverse();
      }
      if (draws) {
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(null);
        gl.enable(gl.DITHER);
      }
      live.made.keep(pools);
      return draws;
    },
    dispose: held.dispose,
  };
}
