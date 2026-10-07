/**
 * A CPU model of the particle step (#759) for the fast tests: it runs the shader's arithmetic in
 * 32-bit floats on exactly what the step handed the GPU, and keeps its state as the GPU would.
 * What the GPU itself does is proved on the bench (`tests/gpu/particles/`).
 */
import { PARTICLE_FLOATS } from '../../../sdk-core/src/fluids/particles.ts'
import { written, type FakeWrite } from '../../../../tests/kit/gpu/fakeDevice.ts'

const f = Math.fround

/** The shader's body for slot `i`, `ring` its uniforms (first slot, count, capacity, then
 *  acceleration and `dt`): the record `k < count` from `staged`, or its particle in `state`,
 *  moved when alive. */
function move(state: ArrayLike<number>, staged: ArrayLike<number>, i: number, ring: number[]) {
  const [first, count, capacity] = ring,
    k = (i + capacity - first) % capacity,
    at = (k < count ? k : i) * PARTICLE_FLOATS,
    from = k < count ? staged : state
  const p = Array.from({ length: PARTICLE_FLOATS }, (_, n) => from[at + n]),
    a = ring.slice(3),
    dt = f(a[3])
  if (p[3] < p[7]) {
    for (let c = 0; c < 3; c++) {
      const gain = f(a[c] * dt)
      p[c] = f(p[c] + f(f(p[4 + c] + f(0.5 * gain)) * dt))
      p[4 + c] = f(p[4 + c] + gain)
    }
    p[3] = f(p[3] + dt)
  }
  return p
}

/** The WebGPU step as `particlesWgsl` runs it: one invocation per slot of the live window the
 *  last step left, then one per record of the ring, then the window of the slots alive after. */
export function webgpuModel(capacity: number) {
  const state = new Float32Array(capacity * PARTICLE_FLOATS)
  let window = [0, 0]
  return {
    particle: (i: number) => [...state.subarray(i * PARTICLE_FLOATS, (i + 1) * PARTICLE_FLOATS)],
    /** One step, handed the `words` and `records` writes. */
    step(words: FakeWrite, records: FakeWrite | undefined) {
      const bytes = new Uint8Array(written(words)).buffer,
        ring = [...new Uint32Array(bytes, 16, 3), ...new Float32Array(bytes, 0, 4)]
      const staged = records ? written(records) : new Float32Array()
      const slots = [
        ...Array.from({ length: window[1] }, (_, n) => window[0] + n),
        ...Array.from({ length: ring[1] }, (_, n) => (ring[0] + n) % capacity),
      ]
      let low = capacity,
        high = 0
      for (const i of slots) {
        const p = move(state, staged, i, ring)
        state.set(p, i * PARTICLE_FLOATS)
        if (p[3] < p[7]) [low, high] = [Math.min(low, i), Math.max(high, i + 1)]
      }
      window = high ? [low, high - low] : [0, 0]
    },
  }
}
