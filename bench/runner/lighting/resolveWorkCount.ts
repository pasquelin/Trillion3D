// What the deferred resolve spends per covered pixel beyond its G-buffer reads, moving or still —
// one sum over every light of the pixel's cell —, on the light grid's lists
// (`lighting/lightGridWalk.ts`), each pixel's point against each listed light's range. COUNTED,
// never timed.
//
// - `setup`: the pixels that set up a shadow read — eight neighbour depths for the unjittered
//   footprint and the receiver offset recomputed from the visibility buffer (`shadowSetup`) —,
//   where the cell's list holds a shadowed light (`cellShadowed`).
// - `shaded`: lights shaded in full (`declaredLight`): the list's `L`.
// - `reaching`: the listed lights holding a slot that reach the pixel: each is one shadow read, a
//   mask byte of the projection, and one mark of the shadow demand pass (`vsm/markingWgsl.ts`).
//
//   node bench/runner/lighting/resolveWorkCount.ts [--width 3456] [--height 2234] [--slots 64]
import { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import type { TileView } from '../../oracles/browser/gpuLightGridOracle.ts'
import { reaches, walkGrid } from './lightGridWalk.ts'
import { ATRIUM_POSES, atriumCountArgs, atriumDepth, atriumLamps } from './lightTileAtrium.ts'
import type { Light } from './lightTileCity.ts'

type Work = { setup: number; shaded: number; reaching: number }

/** Sums over the covered pixels of `view`; `slotted[rank]` whether a light holds a shadow slot. */
export function countResolveWork(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  slotted: boolean[],
) {
  const work: Work = { setup: 0, shaded: 0, reaching: 0 }
  let covered = 0
  walkGrid(view, depths, lights, (p, listed) => {
    covered++
    work.setup += +listed.some((rank) => slotted[rank])
    work.shaded += listed.length
    work.reaching += listed.filter((rank) => slotted[rank] && reaches(p, lights[rank])).length
  })
  return { covered, work }
}

async function main() {
  const { width, height, slots } = atriumCountArgs({ slots: 64 })
  const lights = atriumLamps(200, 4)
  const rows = ATRIUM_POSES.map(({ eye, yaw, pitch }, pose) => {
    const view = camera(eye, yaw, pitch, 60, width, height)
    const { covered, work } = countResolveWork(
      view,
      atriumDepth(view),
      lights,
      lights.map((_, rank) => rank < slots),
    )
    return {
      pose,
      ...Object.fromEntries(Object.entries(work).map(([k, v]) => [k, (v / covered).toFixed(2)])),
    }
  })
  console.log(
    `200 lamps of range 4 m, ${slots} holding a shadow slot, ${width} × ${height}, per covered pixel:`,
  )
  console.table(rows)
}

if (import.meta.main) await main()
