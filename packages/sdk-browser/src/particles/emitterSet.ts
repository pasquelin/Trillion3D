import {
  ParticleEmitter,
  type ParticleEmitterSpec,
  type ParticleSpawn,
} from '../../../sdk-core/src/fluids/emitter.ts'
import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts'
import { attachPool, type PoolHooks } from '../session/world/session.ts'

/** An emitter the page made (`world.particles.add`): it spawns with the world's frames until
 *  `dispose()`. */
export interface ParticleHandle {
  /** Changes what it spawns with, from the next particle on; a field left out stays. */
  update(patch: ParticleSpawn): void
  /** Spawns `count` particles now, whatever the rate and `active` say. */
  burst(count: number): void
  /** Stops it and gives its pool back; its live particles go with it. */
  dispose(): void
}

/** The world's particles: `add` makes an emitter and its pool, spawning and stepping with the
 *  world's frames. The pools are the world's held pools (`switches.held`). */
export function createParticleSet(pools: ParticlePool[], world: PoolHooks) {
  return {
    /** Makes an emitter over a pool of `spec.capacity` particles, spawning at `spec.rate` a second
     *  and by `burst`; the pool's capacity, origin, blend, colour and size are fixed for its life. */
    add(spec: ParticleEmitterSpec): ParticleHandle {
      const emitter = new ParticleEmitter(spec)
      const stopSpawning = world.beforeFrame(({ delta }) => emitter.advance(delta)) // ahead of the pool's own
      const detach = attachPool(pools, world, emitter.pool)
      let disposed = false
      return {
        update: (patch) => (emitter.update(patch), world.invalidate()),
        burst: (count) => (emitter.burst(count), world.invalidate()),
        dispose() {
          if (disposed) return
          disposed = true
          stopSpawning()
          detach()
        },
      }
    },
  }
}
