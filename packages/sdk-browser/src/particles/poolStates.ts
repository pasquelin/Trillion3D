import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';

/** The slots a step covers: past them nothing was ever emitted, and nothing changes. */
export const usedSlots = (pool: ParticlePool) => Math.min(pool.capacity, pool.emitted);

/**
 * Each pool's GPU state on one renderer, the part the WebGPU and WebGL2 steps share: `of` makes
 * a pool's state the first time it moves, `keep` gives back, once per image, the state of every
 * pool the world let go of, and `dispose` all of them. Nothing is allocated while the world's
 * pools stay the same.
 */
export function createPoolStates<State>(
  make: (pool: ParticlePool) => State,
  free: (state: State) => void,
) {
  const made = new Map<ParticlePool, State>();
  const release = (kept: readonly ParticlePool[]) => {
    for (const [pool, state] of made)
      if (!kept.includes(pool)) {
        free(state);
        made.delete(pool);
      }
  };
  return {
    of(pool: ParticlePool) {
      let state = made.get(pool);
      if (!state) made.set(pool, (state = make(pool)));
      return state;
    },
    /** Frees the state of every pool not among `pools`, the world's on this image. */
    keep(pools: readonly ParticlePool[]) {
      let held = 0;
      for (const pool of pools) if (made.has(pool)) held++;
      if (made.size > held) release(pools);
    },
    /** Forgets every state without freeing it: a lost context took them. */
    forget: () => made.clear(),
    dispose: () => release([]),
  };
}
