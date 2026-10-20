// A still coarsened view tries its own threshold again after a wait: back to its own cut once it
// fits — though its ask at the coarse factor did not move, the levels being steps —, and, while it
// still overflows, a try per doubling wait alone, no truncated readout ever adopted. On a
// generated world, each readback what the kernels' oracle cuts under the threshold the cut wrote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { world, worldCut } from './listCoarsen.fixture.ts'

const NEAR = 16

/** The ranks the view asks at its own threshold on a window of `pixels`, and a list it overflows
 *  by a twentieth at a full window. */
function setting(pixels: number) {
  const probe = world(),
    full = probe.lists(probe.view(NEAR)).drawn.length,
    shrunk = probe.lists(probe.view(NEAR, pixels)).drawn.length
  return { full, shrunk, cap: Math.round(full / 1.05) }
}

test('a still coarsened view whose window loses a tenth comes back to its own cut', async () => {
  const { shrunk, cap } = setting(0.9)
  assert.ok(shrunk < cap, `${shrunk} of ${cap}: its own cut fits again`)
  const { selection, frame, threshold, view, lists } = await worldCut(cap)
  for (let k = 0; k < 3; k++) await frame(view(NEAR))
  const raised = selection.coarsen
  assert.ok(raised > 1)
  const smaller = view(NEAR, 0.9)
  const coarse = lists(smaller, Math.fround(smaller.pixelError * raised)).drawn.length,
    before = lists(view(NEAR), Math.fround(smaller.pixelError * raised)).drawn.length
  assert.ok(Math.abs(coarse - before) <= before / 8, 'its ask at the factor barely moved')
  let images = 0,
    cut = await frame(smaller)
  while (selection.coarsen > 1 && ++images < 80) cut = await frame(smaller)
  assert.equal(selection.coarsen, 1, `back to 1 in ${images + 1} images`)
  assert.ok(images <= 65, `${images + 1} images: within the first wait`)
  assert.equal(threshold(), Math.fround(smaller.pixelError), 'the threshold bit for bit')
  assert.equal(cut?.result.truncated, false)
  assert.deepEqual(cut?.result.drawablePageIds, lists(smaller).drawn, 'the view’s own cut')
})

test('a still view past the list tries its own threshold at doubling waits alone', async () => {
  const { cap } = setting(1)
  const { selection, frame, view, readouts } = await worldCut(cap)
  const still = view(NEAR)
  const own = Math.fround(still.pixelError)
  let truncated = 0
  for (let k = 0; k < 64 + 128 + 256 + 32; k++) {
    const cut = await frame(still)
    if (cut?.result.truncated) truncated++
  }
  assert.equal(truncated, 0, 'no truncated readout adopted')
  assert.ok(selection.coarsen > 1, 'still coarse: its own cut still overflows')
  const tries = readouts.filter((r) => r.threshold === own).map((r) => r.image)
  const waits = tries.slice(1).map((image, k) => image - tries[k])
  assert.deepEqual(waits, [64, 128, 256], `tries at images ${tries}`)
})
