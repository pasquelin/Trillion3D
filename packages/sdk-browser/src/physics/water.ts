/**
 * Buoyancy in the physics worker: with a body of water declared, every step first asks the module
 * which pieces of the awake bodies reach the water, gives each its water plane from the wave
 * model, and runs the BUOYANCY command before the page's commands and the step. All of it runs in
 * the physics thread; the page thread only declares the water.
 */
import {
  StepWords,
  createWater,
  sliceLength,
  type Water,
  type WaterSpec,
} from '../../../sdk-core/src/fluids/index.ts';
import { WATER_PIECE_WORDS } from '../../../sdk-core/src/physics/index.ts';
import type { JoltModule } from './joltModule.ts';

/** The worker's water: none until `set`. Its waves are clocked by the steps it runs. */
export function createWaterStep() {
  let water: Water | null = null,
    cut = 0,
    time = 0;
  const words = new StepWords();
  return {
    /** Declares the water (null removes it); its waves start at `time` seconds. */
    set(spec: WaterSpec | null, start = 0) {
      water = spec ? createWater(spec) : null;
      cut = water ? sliceLength(water) : 0;
      time = start;
    },
    /** One step of `jolt` by `dt` seconds, `queued` being the page's commands: the pose count. */
    step(jolt: JoltModule, queued: Uint32Array | null, dt: number) {
      if (!water || dt <= 0) return jolt.step(queued, dt);
      water.waves.setTime(time);
      time += dt;
      const pieces = jolt.water(water.level + water.waves.crest, cut);
      const count = words.write(water, pieces, pieces.length / WATER_PIECE_WORDS, queued);
      return jolt.step(words.words, dt, count);
    },
  };
}
