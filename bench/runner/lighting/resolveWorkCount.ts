// What the deferred resolve of a MOVING image spends per covered pixel beyond its G-buffer reads,
// the `before` resolve (every sampled rank drawn) against the `after` one, both on the light grid's
// lists (`lighting/lightGridWalk.ts`), each pixel's point against each listed light's range.
// COUNTED, never timed; upper bounds where a term depends on a weight or a facing the atrium does
// not model.
//
// - `setup`: the pixels that set up a shadow read — eight neighbour depths for the unjittered
//   footprint and the receiver offset recomputed from the visibility buffer (`shadowSetup`):
//   `before` at every lit pixel, `after` where the cell's list holds a shadowed light
//   (`cellShadowed`).
// - `weights`: `lightWeight` evaluations of a drawn list (`sampledSliceLighting`): three walks of
//   its `L` lights `before`, two `after`.
// - `shaded`: lights shaded in full (`declaredLight`): a full sum's `L`, a drawn list's at most
//   `LIGHT_SAMPLES`.
// - `shadows`: shadow reads, at most the shaded lights holding a slot that reach the pixel, each
//   the PCF's sixteen depth gathers on both sides.
// - `demand`: the lights holding a slot that reach the pixel, each marked by the shadow demand pass
//   (`vsm/markingWgsl.ts`), whatever the draw shades.
//
//   node bench/runner/lighting/resolveWorkCount.ts [--width 3456] [--height 2234] [--slots 64]
import { parseArgs } from 'node:util'
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts'
import { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import type { TileView } from '../../oracles/browser/gpuLightGridOracle.ts'
import { reaches, walkGrid } from './lightGridWalk.ts'
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts'
import type { Light } from './lightTileCity.ts'

const SAMPLES = LIGHT_SETTINGS.samplesPerPixel,
  LIST = LIGHT_SETTINGS.tileLights

export type Work = {
  setup: number
  weights: number
  shaded: number
  shadows: number
  demand: number
}
const zero = (): Work => ({ setup: 0, weights: 0, shaded: 0, shadows: 0, demand: 0 })

/** Sums over the covered pixels of `view`, `before` and `after`; `slotted[rank]` whether
 *  a light holds a shadow slot. */
export function countResolveWork(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  slotted: boolean[],
) {
  const sums = { covered: 0, before: zero(), after: zero() }
  walkGrid(view, depths, lights, (p, listed) => {
    const L = listed.length,
      flagged = listed.some((rank) => slotted[rank]),
      drawn = flagged && L > SAMPLES && L <= LIST
    const reaching = listed.filter((rank) => slotted[rank] && reaches(p, lights[rank])).length
    const shadows = drawn ? Math.min(SAMPLES, reaching) : reaching
    sums.covered++
    for (const [side, walks, setup] of [
      [sums.before, 3, true],
      [sums.after, 2, flagged],
    ] as const) {
      side.setup += +setup
      side.weights += drawn ? walks * L : 0
      side.shaded += drawn ? SAMPLES : L
      side.shadows += shadows
      side.demand += reaching
    }
  })
  return sums
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3456' },
      height: { type: 'string', default: '2234' },
      slots: { type: 'string', default: '64' },
    },
  })
  const [width, height, slots] = [values.width, values.height, values.slots].map(Number)
  const lights = atriumLamps(200, 4)
  const rows = ATRIUM_POSES.flatMap(({ eye, yaw, pitch }, pose) => {
    const view = camera(eye, yaw, pitch, 60, width, height)
    const s = countResolveWork(
      view,
      atriumDepth(view),
      lights,
      lights.map((_, rank) => rank < slots),
    )
    return (['before', 'after'] as const).map((side) => ({
      pose,
      side,
      ...Object.fromEntries(
        Object.entries(s[side]).map(([k, v]) => [k, (v / s.covered).toFixed(2)]),
      ),
    }))
  })
  console.log(
    `Moving image, 200 lamps of range 4 m, ${slots} holding a shadow slot, ${width} × ${height}, per covered pixel:`,
  )
  console.table(rows)
}

if (import.meta.main) await main()
