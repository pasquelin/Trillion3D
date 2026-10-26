// The feedback word a pass reads (`phaseWord`): the pick turn rides above the phase and the
// "every pixel" bit, on every image.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FEEDBACK_EVERY,
  FEEDBACK_STRIDE,
  PICK_SHIFT,
  createWebgpuTileFeedback,
} from './feedback.ts'
import { reversedMortonOffset } from '../../../../math/src/sequence/reversedMorton.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
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

// One pixel in 16 × 16 speaks an image; a round of images names each pixel of the square once, and
// its first images speak from pixels far apart.
test('a phase round speaks every pixel of the square once, the first images spread over it', () => {
  const heard = new Set<number>()
  for (let phase = 0; phase < FEEDBACK_EVERY; phase++)
    heard.add(reversedMortonOffset(phase, FEEDBACK_STRIDE))
  assert.equal(heard.size, FEEDBACK_EVERY)
  assert.ok(FEEDBACK_STRIDE === 16 && [...heard].every((word) => word < FEEDBACK_EVERY))
  const column = (word: number) => word % FEEDBACK_STRIDE,
    row = (word: number) => Math.floor(word / FEEDBACK_STRIDE)
  const quadrants = new Set(
    [0, 1, 2, 3].map((phase) => {
      const word = reversedMortonOffset(phase, FEEDBACK_STRIDE)
      return Number(column(word) >= 8) + 2 * Number(row(word) >= 8)
    }),
  )
  assert.equal(quadrants.size, 4, 'four images, four quarters of the square')
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
