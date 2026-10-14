// The feedback word a pass reads (`phaseWord`): the pick turn rides above the phase and the
// "every pixel" bit, on every image.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FEEDBACK_EVERY, PICK_SHIFT, createWebgpuTileFeedback } from './feedback.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { PICK_CYCLE } from './pickCycle.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'

// Ordinary images must turn the pick, so a live view asks the sliver's
// tile. Each pixel speaks once per phase round: the pick turns once per round, and each pixel
// steps through every pick as it speaks. A convergence image names every pick itself.
test('ordinary images turn the pick once per whole phase round', () => {
  const feedback = createWebgpuTileFeedback(fakeDevice().device, 4)
  const picks = new Set<number>()
  for (let image = 0; image < FEEDBACK_EVERY * PICK_CYCLE; image++) {
    const word = feedback.phaseWord(false)
    if ((word & (FEEDBACK_EVERY - 1)) === 5) picks.add(word >> PICK_SHIFT)
    assert.equal(word & FEEDBACK_EVERY, 0)
    assert.equal(feedback.phaseWord(true), word | FEEDBACK_EVERY)
    feedback.submitted()
  }
  assert.equal(picks.size, PICK_CYCLE, 'one pixel of the square named every pick')
})

test('feedback growth discards completed and in-flight counts from the previous slot layout', async () => {
  let resume!: () => void
  const mapping = new Promise<void>((resolve) => {
    resume = resolve
  })
  const { device, buffers, destroyed } = fakeDevice({ ...BACKEND, mapping })
  const feedback = createWebgpuTileFeedback(device, 4)
  feedback.encode(device.createCommandEncoder())
  feedback.submitted()
  const old = buffers.slice(),
    [counters, list] = old
  feedback.grow(8)
  assert.ok(
    !old.some((buffer) => destroyed.includes(buffer)),
    'the image encoded may still name them: nothing destroyed at the growth',
  )
  destroyRetired(device)
  assert.ok(
    [counters, list].every((buffer) => destroyed.includes(buffer)),
    'the outgrown counters and list, once the frame is submitted',
  )
  resume()
  await feedback.settled()
  assert.equal(feedback.take(), undefined, 'late old counts cannot name new slots')
  feedback.encode(device.createCommandEncoder())
  feedback.submitted()
  await feedback.settled()
  assert.equal(feedback.take()?.index.length, 8, 'listing at most the ranks of its generation')
  const staging = buffers.filter(({ label }) => label === 'Trillion3D texture feedback readback')
  assert.equal(staging.length, 3, 'one ring: one buffer made again at the grown size, at a take')
  feedback.grow(2)
  assert.equal(feedback.take(), undefined, 'completed counts are also invalidated')
  feedback.destroy()
})
