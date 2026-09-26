/**
 * CPU models of the two particle steps (#759) for the fast tests: each runs its shader's
 * arithmetic in 32-bit floats on exactly what its step handed the GPU, and keeps its state as the
 * GPU would. What the GPU itself does is the measurer's (`tests/browser/probes/particles-step-*`).
 */
import { PARTICLE_FLOATS, type ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { written, type FakeWrite } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createTestContext } from '../webgl/core/testContext.fixture.ts';
import { PARTICLE_WORKGROUP } from './webgpuParticles.ts';
import { PARTICLE_ROW, createWebglParticles } from './webglParticles.ts';

const f = Math.fround;

/** A context granting the `granted` extensions and giving `answers`, its WebGL2 `particles`, and
 *  a `run` of their step that answers the draws made and the calls it made, by name. */
export function webgl(granted = ['EXT_color_buffer_float'], answers: Record<string, unknown> = {}) {
  const getExtension = (name: string) => (granted.includes(name) ? {} : null);
  const ctx = createTestContext({ answers: { getExtension, ...answers } }),
    particles = createWebglParticles(ctx.gl);
  const run = (pools: ParticlePool[]) => {
    const from = ctx.calls.length,
      draws = particles.run(pools),
      calls = ctx.calls.slice(from);
    return { draws, of: (name: string) => calls.filter((c) => c.name === name).map((c) => c.args) };
  };
  return { ctx, run, particles };
}

/** Both shaders' body for slot `i`, `ring` their uniforms (first slot, count, capacity, then
 *  acceleration and `dt`): the record `k < count` from `staged`, or its particle in `state`,
 *  moved when alive. */
function move(state: ArrayLike<number>, staged: ArrayLike<number>, i: number, ring: number[]) {
  const [first, count, capacity] = ring,
    k = (i + capacity - first) % capacity,
    at = (k < count ? k : i) * PARTICLE_FLOATS,
    from = k < count ? staged : state;
  const p = Array.from({ length: PARTICLE_FLOATS }, (_, n) => from[at + n]),
    a = ring.slice(3),
    dt = f(a[3]);
  if (p[3] < p[7]) {
    for (let c = 0; c < 3; c++) {
      p[4 + c] = f(p[4 + c] + f(a[c] * dt));
      p[c] = f(p[c] + f(p[4 + c] * dt));
    }
    p[3] = f(p[3] + dt);
  }
  return p;
}

/** The WebGPU step as `PARTICLES_WGSL` runs it: one invocation per dispatched slot. */
export function webgpuModel(capacity: number) {
  const state = new Float32Array(capacity * PARTICLE_FLOATS);
  return {
    particle: (i: number) => [...state.subarray(i * PARTICLE_FLOATS, (i + 1) * PARTICLE_FLOATS)],
    /** One dispatch of `groups` workgroups, handed the `words` and `records` writes. */
    step(words: FakeWrite, records: FakeWrite | undefined, groups: number) {
      const bytes = new Uint8Array(written(words)).buffer,
        ring = [...new Uint32Array(bytes, 16, 3), ...new Float32Array(bytes, 0, 4)];
      const staged = records ? written(records) : new Float32Array();
      for (let i = 0; i < Math.min(ring[2], groups * PARTICLE_WORKGROUP); i++)
        state.set(move(state, staged, i, ring), i * PARTICLE_FLOATS);
    },
  };
}

/** The WebGL2 step as `PARTICLES_GLSL` runs it, from one target into the other. */
export function webglModel(capacity: number) {
  const texels = 2 * PARTICLE_ROW,
    size = Math.ceil(capacity / PARTICLE_ROW) * texels * 4;
  let [read, write] = [new Float32Array(size), new Float32Array(size)];
  const staged = new Float32Array(size);
  return {
    particle: (i: number) => [...read.subarray(i * PARTICLE_FLOATS, (i + 1) * PARTICLE_FLOATS)],
    /** One draw, from its texel uploads, `uStep`, `uRing` and viewport rows, by name. */
    step(of: (name: string) => unknown[][]) {
      const ring = [...of('uniform3i')[0].slice(1), ...of('uniform4f')[0].slice(1)] as number[],
        rows = (of('viewport').at(-1) as number[])[3];
      for (const [, , x, y, width, height, , , data, from] of of('texSubImage2D') as number[][]) {
        const records = (data as unknown as Float32Array).subarray(from, from + width * height * 4);
        staged.set(records, (y * texels + x) * 4);
      }
      for (let i = 0; i < Math.min(rows * PARTICLE_ROW, ring[2]); i++)
        write.set(move(read, staged, i, ring), i * PARTICLE_FLOATS);
      [read, write] = [write, read];
    },
  };
}
