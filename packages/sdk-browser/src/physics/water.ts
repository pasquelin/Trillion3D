/**
 * Buoyancy in the physics worker: with a body of water declared, every step first asks the module
 * which pieces of the awake bodies reach the water and their water planes from the wave model,
 * and runs the BUOYANCY command before the page's commands and the step. All of it runs in
 * the physics thread; the page thread only declares the water.
 */
import {
  StepWords,
  createWater,
  sliceLength,
  type Water,
  type WaterSpec,
} from '../../../sdk-core/src/fluids/index.ts'
import { WATER_PIECE_WORDS } from '../../../sdk-core/src/physics/index.ts'
import type { JoltModule } from './joltModule.ts'

/** The worker's water: none until `set`. Its waves are clocked by the page's steps: a step taken
 *  from the page's step `index` sees them at `(index − at) · dt` seconds, `at` the step the water
 *  was set at, so the time a world at rest let pass without a step ran them on all the same, and
 *  the page draws the same waves from the same whole numbers (`stepClock.ts`). */
export function createWaterStep() {
  let water: Water | null = null,
    cut = 0,
    from = 0
  const words = new StepWords()
  return {
    /** Declares the water (null removes it); its waves start at 0 s on the page's step `at`. */
    set(spec: WaterSpec | null, at: number) {
      water = spec ? createWater(spec) : null
      cut = water ? sliceLength(water) : 0
      from = at
    },
    /** One step of `jolt` by `dt` seconds from the page's step `index`, `queued` being the page's
     *  commands: the pose count. */
    step(jolt: JoltModule, queued: Uint32Array | null, dt: number, index: number) {
      if (!water || dt <= 0) return jolt.step(queued, dt)
      water.waves.setTime((index - from) * dt)
      const pieces = jolt.water(water.level + water.waves.crest, cut).length / WATER_PIECE_WORDS
      const planes = jolt.planes(water.waves, water.level, water.sample, pieces)
      // Written first: a step larger than the last grows `words.words`.
      const count = words.write(water, planes, queued)
      return jolt.step(words.words, dt, count)
    },
  }
}
