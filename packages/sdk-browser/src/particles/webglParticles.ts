import { PARTICLE_FLOATS, type ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { boundToContext } from '../webgl/core/contextBound.ts';
import { FULLSCREEN_VERTEX, setFullscreenPassState } from '../webgl/core/fullscreenPass.ts';
import { createWebglProgram } from '../webgl/core/program.ts';
import {
  bindWebglTexture,
  createWebglRenderTarget,
  floatTargets,
  type WebglRenderTarget,
} from '../webgl/core/renderTarget.ts';
import { createPoolStates, refuseAll, usedSlots } from './poolStates.ts';
import { createWebglParticleDraw } from './webglParticleDraw.ts';

/** Particles per texture row, two texels each: position and age, then velocity and lifetime. */
export const PARTICLE_ROW = 512;
const TEXELS = 2 * PARTICLE_ROW,
  FLOAT = { depth: false, float: true };

/** The WGSL step texel by texel: the slot's particle, or the record the ring gives it this image,
 *  moved when alive; the half of it this texel holds is written. */
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

type PoolState = { targets: [WebglRenderTarget, WebglRenderTarget]; staged: WebglRenderTarget };

/**
 * The WebGL2 particle step: each pool's state in two 32-bit float targets drawn in turn by one
 * full-screen pass over the rows its emitted slots fill, reading the other target and the
 * pool's records staged as 32-bit float texels. Its targets are made the first time a pool
 * moves, given back the image after the world lets it go, and rebuilt after a lost context. A
 * context without `EXT_color_buffer_float` refuses every pool by name, never steps it with less.
 * The pass leaves no framebuffer, program or vertex array bound.
 */
export function createWebglParticles(gl: WebGL2RenderingContext) {
  /** Each pool's targets, made on the live context and lost with it. */
  const poolStates = () =>
    createPoolStates<PoolState>(
      (pool) => {
        const target = (records: number) =>
          createWebglRenderTarget(gl, TEXELS, Math.ceil(records / PARTICLE_ROW), FLOAT);
        const [read, write, staged] = [pool.capacity, pool.capacity, pool.emitPerFrame].map(target);
        return { targets: [read, write], staged };
      },
      ({ targets, staged }) => [...targets, staged].forEach((target) => target.dispose()),
    );
  const held = boundToContext(
    gl,
    () => {
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
    if (full) gl.texSubImage2D(TEXTURE_2D, 0, 0, 0, TEXELS, full, RGBA, FLOAT, pool.staging, 0);
    if (rest) {
      const from = full * PARTICLE_ROW * PARTICLE_FLOATS;
      gl.texSubImage2D(TEXTURE_2D, 0, 0, full, 2 * rest, 1, RGBA, FLOAT, pool.staging, from);
    }
  };
  const latest = (pool: ParticlePool) => held.current()?.made.peek(pool)?.targets[0].texture;
  const drawn = createWebglParticleDraw(gl, TEXELS, latest);
  return {
    draw: drawn.draw,
    /** Steps `pools`; returns the draws made. Throws `PARTICLES_UNSUPPORTED`, the pools refused,
     *  on a context without 32-bit float targets. */
    run(pools: readonly ParticlePool[]) {
      const live = held.current();
      if (!live) return 0;
      if (!floatTargets(gl)) {
        refuseAll(pools); // it asks no frame of its own
        if (!pools.length) return 0;
        throw new Error(
          'PARTICLES_UNSUPPORTED: WebGL2 particles render 32-bit floats, and this context ' +
            'does not grant EXT_color_buffer_float',
        );
      }
      let draws = 0;
      for (const pool of pools) {
        pool.refused = false; // stepped here, as WebGPU does once its pipeline is made
        const { first, count, dt } = pool.flush();
        if (!count && !dt) continue;
        const { targets, staged } = live.made.of(pool);
        if (!draws++) {
          setFullscreenPassState(gl);
          gl.useProgram(live.program);
          gl.bindVertexArray(live.vao);
          // Records as they are: an image upload may have left flipping or premultiplying on.
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
        bindWebglTexture(gl, 1, staged.texture);
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
    dispose: () => (held.dispose(), drawn.dispose()),
  };
}
