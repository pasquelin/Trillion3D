import type { ActionSampler } from '../../../sdk-core/src/world/animation/mixer.ts'

/**
 * A lent sampler that counts what the ahead channel did, read from outside as the mixer reads it:
 * samples asked ahead, samples taken from the worker's buffer (`at` is not 0) and samples the main
 * thread computed itself (`at` is 0). The engine keeps no such counter.
 */
export function countingSampler(sampler: ActionSampler) {
  const counts = { asked: 0, taken: 0, missed: 0 }
  const counting: ActionSampler = {
    bind(tracks, fallback) {
      const bound = sampler.bind(tracks, fallback)
      if (!bound) return bound
      return {
        offsets: bound.offsets,
        get at() {
          return bound.at
        },
        sample(t) {
          const numbers = bound.sample(t)
          if (bound.at) counts.taken++
          else counts.missed++
          return numbers
        },
        ahead: bound.ahead
          ? (t) => {
              counts.asked++
              bound.ahead!(t)
            }
          : undefined,
        release: () => bound.release(),
      }
    },
    frame: () => sampler.frame?.(),
  }
  return { sampler: counting, counts }
}
