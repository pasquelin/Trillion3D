// The cut's two-pass occlusion holds back what the previous image's pyramid hides, and a still view
// under the antialiasing jitter converges to a held image. A wall and a slab behind it: seen beside
// the wall, the slab is drawn into the pyramid; hidden behind it, the main pass holds it for the
// post pass (`occluded`), the post pass's pyramid hides it again (`postHidden > 0`), and the image is
// held within the limit. Every held image equals a fresh engine's at the same pose, pixel for pixel,
// temporal antialiasing on (`twoPassPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../../kit/device/enginePageProof.ts'

type Reading = Awaited<ReturnType<typeof import('./twoPassPage.ts').runTwoPass>>

test('the previous pyramid holds back, the post pass hides, and the still view holds', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'twoPassPage.ts'),
    'hizTwoPass',
    'runTwoPass',
  )) as Reading
  console.log(JSON.stringify({ adapter: reading.adapter, steps: reading.steps }))
  assertSoundProof(reading)
  const [beside, hidden, again] = reading.steps
  for (const { x, images, gap } of reading.steps) {
    assert.ok(images !== null, `at x=${x}, the still view was never held`)
    assert.equal(gap, 0, `at x=${x}, the held image differs from a fresh engine's on ${gap} pixels`)
  }
  assert.ok(beside.slab > 0, 'beside the wall, the slab is seen')
  assert.equal(hidden.slab, 0, 'behind the wall, the slab is hidden')
  assert.ok(again.slab > 0, 'beside the wall again, the slab is seen again')
  // Drawn beside the wall, then hidden: the previous pyramid holds the slab back from the main
  // pass, and the post pass's pyramid hides it again. The counts are the cut's, every image: what
  // the main pass held is published, what the post pass hid is asserted.
  assert.equal(beside.postHidden, 0, 'beside the wall, the post pass hides nothing')
  assert.ok(hidden.postHidden > 0, 'behind the wall, the post pass hid nothing the main pass held')
})
