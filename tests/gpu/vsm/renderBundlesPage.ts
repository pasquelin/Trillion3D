// The page of the render bundles proof (`render-bundles.gpu.ts`): the street view of the facade under a casting sun on a fresh world, settled and
// read back, bundled twice and as direct commands once; the page compares the three and returns the counts.
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { poseAt, VIEWS } from '../../../bench/runner/trajectory/poses.ts'
import { countBundles, withDirectBundles } from '../../kit/device/directBundles.ts'
import { settle } from '../world/proofWorld.ts'
import { openBenchWorld } from './shadowScene.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
// The subject is not the meter: a fixed exposure, as `facingWorld.ts` says why.
import { FIXED_EXPOSURE } from '../frame/facingWorld.ts'

/** A bundle replays the very commands the pass would encode, at any size: every pass the view runs
 *  — raster, surfaces, shadow pages — runs at this one, and its 57 600 pixels still span the facade
 *  and the shadows the sun cuts into it, at a quarter of the cost of three settled worlds. */
const SIZE: [number, number] = [320, 180]

/** The street view of the facade under the casting sun on a fresh world, settled and read back,
 *  with the labels of the bundles its frames recorded and how many lists they executed. */
async function settledView() {
  const counting = countBundles()
  const world = await openBenchWorld('facade-7', SIZE, FIXED_EXPOSURE)
  try {
    world.addLight({ ...SUN, castsShadow: true })
    await world.awaitPages()
    const held = !!(await settle(world, poseAt(world.bounds, VIEWS.ground.index)))
    const pixels = new Uint8Array(await world.capture())
    const { executed, labels } = counting.counts
    return { held, pixels, executed, labels: [...labels].sort() }
  } finally {
    world.dispose()
    counting.restore()
  }
}

export async function run() {
  const bundled = await settledView(),
    again = await settledView()
  const direct = await withDirectBundles(settledView)
  return {
    held: [bundled.held, again.held, direct.held],
    executed: bundled.executed,
    labels: bundled.labels,
    stable: compareImages(bundled.pixels, again.pixels).differentPixels,
    gap: compareImages(bundled.pixels, direct.pixels).differentPixels,
    pixels: bundled.pixels.length / 4,
  }
}
