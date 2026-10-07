import type { ParticlePool, ParticleStep } from '../../../sdk-core/src/fluids/particles.ts'

/** The step uniform, the WGSL `Step`: acceleration and `dt`, then the ring's first slot, count
 *  and capacity, and the workgroups of its records — the partial windows past the window's that its
 *  `bound` folds. Made once; `write` rewrites it for one pool's step. */
export function createStepWords() {
  const buffer = new ArrayBuffer(32),
    floats = new Float32Array(buffer),
    uints = new Uint32Array(buffer)
  const write = (
    pool: ParticlePool,
    { first, count, dt }: Readonly<ParticleStep>,
    groups: number,
  ) => {
    floats.set(pool.acceleration)
    floats[3] = dt
    uints[4] = first
    uints[5] = count
    uints[6] = pool.capacity
    uints[7] = groups
  }
  return { buffer, write }
}
