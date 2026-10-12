// The bench's one scene, its own page (`bench/kit/scenes/an-open-world-of-every-cost.html`): an open
// world carrying every cost the engine counts at once, each part a switch. The scenario `world`
// sets it moving on its first measured frame, flies over it, low, past each part, and holds still.
import type { Scenario } from './scenario.ts'

/** The scene the bench plays by default. */
export const BENCH_SCENE = 'an-open-world-of-every-cost'

/** The key the scene starts its motion on — its water, bodies and trees — held until then, so the
 *  motion starts on the same frame of every play, whatever the warm-up took. */
export const START_KEY = 'KeyP'

const pose = (position: [number, number, number], target: [number, number, number]) => ({
  position,
  target,
})

/** The scenario flown over the scene: a high approach to the field's edge (the blocks, the
 *  mountain, the basin), a low glide between the blocks to the water and what floats on it, the
 *  yard (the garden, the stirred bin, the trees in the wind), the pebble bed and its glass close
 *  under the low sun, then a still image. */
export const WORLD_SCENARIO: Scenario = {
  name: 'world',
  page: BENCH_SCENE,
  segments: [
    {
      name: 'approach',
      frames: 240,
      camera: { from: pose([0, 200, 760], [0, 0, 0]), to: pose([0, 25, 120], [0, 5, -80]) },
      events: [
        { frame: 0, type: 'keydown', code: START_KEY, key: 'p' },
        { frame: 1, type: 'keyup', code: START_KEY, key: 'p' },
      ],
      capture: true,
    },
    {
      name: 'glide',
      frames: 240,
      camera: { from: pose([0, 6, 60], [0, 4, -60]), to: pose([30, 3, -20], [30, 0, -60]) },
      capture: true,
    },
    {
      name: 'yard',
      frames: 240,
      camera: {
        from: pose([-26, 9, 23], [-46, 0.5, 0]),
        to: pose([-40, 8, -23], [-48, 0.5, 0]),
      },
      capture: true,
    },
    {
      name: 'bed',
      frames: 240,
      camera: { from: pose([2.2, 0.9, 3.2], [-1, 0, -1]), to: pose([-2.2, 0.7, 2.4], [1, 0, -1]) },
      capture: true,
    },
    { name: 'still', frames: 240, capture: true },
  ],
}
