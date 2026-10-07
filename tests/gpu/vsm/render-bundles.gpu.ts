// The visibility raster and the material surfaces are executed as render bundles; the shadow
// raster's chunk passes encode their four commands directly (a pass each, nothing to bundle). On the
// generated facade the sun cuts sharp shadows into (`facade-7`), the settled street view drawn with
// the bundles equals, pixel for pixel, the same view of a fresh world whose bundles are encoded as
// their commands in the pass (`withDirectBundles`): image class 1, the shadow pages included. Two
// fresh worlds with bundles prove the view stable (A/A, 0 px) before the comparison means anything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { poseAt, VIEWS } from '../../../bench/runner/trajectory/poses.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { countBundles, withDirectBundles } from '../kit/directBundles.ts'
import { settle } from '../world/proofWorld.ts'
import { openBenchWorld } from './shadowScene.ts'

/** A bundle replays the very commands the pass would encode, at any size: every pass the view runs
 *  — raster, surfaces, shadow pages — runs at this one, and its 57 600 pixels still span the facade
 *  and the shadows the sun cuts into it, at a quarter of the cost of three settled worlds. */
const SIZE: [number, number] = [320, 180]

/** The street view of the facade under the casting sun on a fresh world, settled and read back,
 *  with the labels of the bundles its frames recorded and how many lists they executed. */
async function settledView() {
  const counting = countBundles()
  const world = await openBenchWorld('facade-7', SIZE)
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

async function bundledAgainstDirect() {
  // Read once Dawn is installed: the image kit loads engine modules.
  const { difference } = await import('../kit/sceneImageProof.ts')
  const bundled = await settledView(),
    again = await settledView()
  const direct = await withDirectBundles(settledView)
  return {
    held: [bundled.held, again.held, direct.held],
    executed: bundled.executed,
    labels: bundled.labels,
    stable: difference(bundled.pixels, again.pixels),
    gap: difference(bundled.pixels, direct.pixels),
    pixels: bundled.pixels.length / 4,
  }
}

test(
  'the bundled passes over a casting sun draw the image their commands draw',
  { timeout: 300_000 },
  async () => {
    const errors: string[] = []
    const reading = await runOnDawn(bundledAgainstDirect, null, errors)
    console.log(JSON.stringify(reading))
    assert.deepEqual(errors, [])
    assert.deepEqual(reading.held, [true, true, true], 'every world settles its view')
    assert.ok(reading.executed > 0, 'the frames executed bundles')
    assert.ok(!reading.labels.includes('vsm.render.raster'), 'the shadow raster is direct')
    assert.equal(reading.stable, 0, 'two fresh worlds draw the same view (A/A)')
    assert.equal(reading.gap, 0, `the bundles change ${reading.gap} pixels of ${reading.pixels}`)
  },
)
