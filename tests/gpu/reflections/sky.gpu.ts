// A glass pane under an open sky (`skyPage.ts`): its mirror ray leaves the scene, and no sky light shines, so it reflects black
// whatever the background the screen draws and whatever light the scene declares around it: the background colour is not
// radiance a mirror reads.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/sky.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'
import type { SkyCase } from './skyPage.ts'

/** The sky shown, a mid grey. */
const SKY = 0x808080
/** A declared light around the scene (its irradiance, a radiance of 1/π of it), far dimmer than the sky and brighter than it. */
const DIM = 0.02,
  BRIGHT = 3

const CASES: SkyCase[] = [
  { sky: SKY, rough: 0.02 },
  { sky: SKY, declared: DIM, rough: 0.02 },
  { sky: SKY, declared: BRIGHT, rough: 0.02 },
  { declared: BRIGHT, rough: 0.02 },
]

test('a pane under an open sky with no sky light reflects black, whatever background is drawn or light declared', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'skyPage.ts'),
    'reflectionSky',
  )) as typeof import('./skyPage.ts')
  const result = await runOnDawn(page.run, CASES)
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  console.log(JSON.stringify(result.poses))
  const poses = result.poses!
  poses.forEach(({ maximum, pixels }, k) => {
    assert.ok(pixels > 500, `case ${k}: ${pixels} pane pixels`)
    assert.ok(maximum < 0.005, `case ${k}: ${maximum} reflected, no sky light shining`)
  })
})
