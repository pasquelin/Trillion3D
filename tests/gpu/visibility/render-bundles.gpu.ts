// The visibility raster's slot draws and the material surfaces are executed as render bundles,
// recorded once and replayed while what they name holds. On the real engine under the two-pass
// occlusion and temporal antialiasing, every held image equals, pixel for pixel, that of a second
// engine walking the same poses whose bundles are encoded as their commands in the pass
// (`renderBundlesPage.ts`): image class 1.
// The bundles are executed at every pose; once the first pose met every input, a pose's images
// after its first record none, and the return to a pose drawn before records nothing — the CPU
// records a bundle only on the image an input moved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Reading = Awaited<ReturnType<typeof import('./renderBundlesPage.ts').runRenderBundles>>

test('the bundled raster and surfaces draw the image their commands draw', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'renderBundlesPage.ts'),
    'renderBundles',
    'runRenderBundles',
  )) as Reading
  console.log(JSON.stringify({ adapter: reading.adapter, steps: reading.steps }))
  assertSoundProof(reading)
  assert.equal(reading.steps.length, 3)
  for (const [at, { x, executed, recordedAfterFirst, gap }] of reading.steps.entries()) {
    assert.equal(gap, 0, `at x=${x}, the held image differs from the direct one on ${gap} pixels`)
    assert.ok(executed > 0, `at x=${x}, no bundle was executed`)
    // The first pose's first images meet each input once — the tested half compacted or not.
    if (at > 0) assert.equal(recordedAfterFirst, 0, `at x=${x}, a still view recorded again`)
  }
  assert.ok(reading.steps[0].recorded > 0, 'the first pose records the bundles it draws')
  assert.deepEqual(
    reading.steps[0].labels,
    ['Trillion3D material classes', 'Trillion3D visibility slots'],
    'the raster halves and the surfaces are bundled',
  )
  assert.equal(reading.steps[2].recorded, 0, 'back at a pose drawn before, nothing is recorded')
})
