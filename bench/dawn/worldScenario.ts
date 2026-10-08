// The bench's one scene is a page of the examples (`site/examples/an-open-world-of-every-cost.html`):
// an open world carrying every cost the engine counts at once, each part a switch, so it is seen and
// checked in the gallery before it is measured. The scenario `world` flies over it, low, and holds
// still. The page is the only source: the bench builds no scene of its own.
import type { Scenario } from './scenario.ts'

/** The example the bench plays by default. */
export const BENCH_SCENE = 'an-open-world-of-every-cost'

const pose = (position: [number, number, number], target: [number, number, number]) => ({
  position,
  target,
})

/** The scenario flown over the scene: a high approach to the field's edge, a low glide between the
 *  blocks, the pebble bed close under the low sun, then a still image. */
export const WORLD_SCENARIO: Scenario = {
  name: 'world',
  page: BENCH_SCENE,
  segments: [
    {
      name: 'approach',
      frames: 240,
      camera: { from: pose([0, 200, 760], [0, 0, 0]), to: pose([0, 25, 120], [0, 5, -80]) },
      capture: true,
    },
    {
      name: 'glide',
      frames: 240,
      camera: { from: pose([0, 6, 60], [0, 4, -60]), to: pose([30, 3, -20], [30, 3, -160]) },
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
