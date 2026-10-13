// A glass pane under an open sky (`skyPage.ts`): its mirror ray leaves the scene, and what it
// reflects is what the view shows in its direction, times the pane's weight (a polished surface's,
// between 0.9 and 1 at grazing): the declared background, whatever light the scene declares around
// it — a light brighter than the sky the view shows is not what the view shows there —, and that
// light where the scene declares no background.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/sky.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { srgbToLinear } from '../../../packages/math/src/color/color.ts'
import type { SkyCase } from './skyPage.ts'

/** The sky shown, a mid grey: its linear radiance. */
const SKY = 0x808080
const SKY_LINEAR = srgbToLinear(0x80 / 255)
/** A declared light around the scene (its irradiance, a radiance of 1/π of it), far dimmer than the sky and brighter than it. */
const DIM = 0.02,
  BRIGHT = 3

const CASES: SkyCase[] = [
  { sky: SKY, rough: 0.02 },
  { sky: SKY, declared: DIM, rough: 0.02 },
  { sky: SKY, declared: BRIGHT, rough: 0.02 },
  { declared: BRIGHT, rough: 0.02 },
]

test('a pane under an open sky reflects what the view shows there: the background, else the declared light', async () => {
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
    const expected = CASES[k].sky === undefined ? (CASES[k].declared ?? 0) / Math.PI : SKY_LINEAR
    assert.ok(minimum >= 0.9 * expected - 0.005, `case ${k}: ${minimum} of a sky of ${expected}`)
    assert.ok(maximum <= 1.01 * expected + 0.005, `case ${k}: ${maximum} of a sky of ${expected}`)
  })
})
