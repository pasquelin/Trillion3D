// A glass pane under an open sky (`skyPage.ts`): its mirror ray leaves the scene, and what it
// reflects is what the screen draws in its direction, times the pane's weight (a polished
// surface's, between 0.9 and 1 at grazing): the background, whatever light the scene declares
// around it — a light brighter than the sky is not what the screen draws there —, the engine's
// default colour where the scene declares none, never black.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/sky.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { srgbToLinear } from '../../../packages/math/src/color/color.ts'
import { clearValueOf } from '../../../packages/sdk-core/src/world/math/packedColour.ts'
import { RASTER_BACKGROUND } from '../../../packages/sdk-browser/src/page/raster.ts'
import type { SkyCase } from './skyPage.ts'

/** The sky shown, a mid grey. */
const SKY = 0x808080
/** The linear radiance of the sky a case shows, its lowest and highest channel: the declared
 *  colour, or the engine's default (`RASTER_BACKGROUND`), through no curve at an exposure of one. */
const skyOf = (sky = RASTER_BACKGROUND) => {
  const { r, g, b } = clearValueOf(sky)
  const linear = [r, g, b].map(srgbToLinear)
  return { low: Math.min(...linear), high: Math.max(...linear) }
}
/** A declared light around the scene (its irradiance, a radiance of 1/π of it), far dimmer than the sky and brighter than it. */
const DIM = 0.02,
  BRIGHT = 3

const CASES: SkyCase[] = [
  { sky: SKY, rough: 0.02 },
  { sky: SKY, declared: DIM, rough: 0.02 },
  { sky: SKY, declared: BRIGHT, rough: 0.02 },
  { declared: BRIGHT, rough: 0.02 },
]

test('a pane under an open sky reflects the background the screen draws, declared or the default', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'skyPage.ts'),
    'reflectionSky',
  )) as typeof import('./skyPage.ts')
  const result = await runOnDawn(page.run, CASES)
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  console.log(JSON.stringify(result.poses))
  const poses = result.poses!
  poses.forEach(({ minimum, maximum, pixels }, k) => {
    assert.ok(pixels > 500, `case ${k}: ${pixels} pane pixels`)
    const { low, high } = skyOf(CASES[k].sky)
    assert.ok(minimum > 0, `case ${k}: a mirror under the sky is never black`)
    assert.ok(minimum >= 0.9 * low - 0.005, `case ${k}: ${minimum} of a sky of ${low}`)
    assert.ok(maximum <= 1.01 * high + 0.005, `case ${k}: ${maximum} of a sky of ${high}`)
  })
})
