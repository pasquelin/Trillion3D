// The factor a view's threshold is cut under past the device's list: it rises on an overflow
// alone; it tries the view's own threshold again once the view clearly changed or, after a wait
// each failed try doubles — whatever the law the cut follows —; a grown list releases it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { coarsenAfter, coarsenTick, createCoarsening, type Coarsening } from './coarsening.ts'

const CAP = 1000

/** One image of a view that asks `full` ranks at its own threshold, its cut following
 *  D(f) = full / f^`law`: the readout, past the list or not, followed. */
function image(c: Coarsening, full: number, law = 2) {
  const demand = full / c.factor ** law
  return coarsenAfter(c, demand, CAP, demand > CAP)
}

test('below the device list the factor stays 1, whatever the cut asks', () => {
  const c = createCoarsening()
  for (const demand of [0, 10, 900, 1000]) assert.equal(coarsenAfter(c, demand, CAP, false), false)
  assert.equal(c.factor, 1)
})

test('an overflow raises the factor to fill half the list, √2 at least, its coarsest at most', () => {
  const at = (factor: number, demand: number) => {
    const c = { ...createCoarsening(), factor }
    coarsenAfter(c, demand, CAP, true)
    return c.factor
  }
  assert.ok(Math.abs(at(1, 4000) - Math.sqrt(8)) < 1e-12, 'D/f² at half the list')
  assert.equal(at(1, 1001), Math.sqrt(2.002), 'past half by the law')
  assert.equal(at(1, 600), Math.SQRT2, 'a step of √2 at least')
  assert.equal(at(2 ** 16, 1e12), 2 ** 16, 'and the coarsest at most')
})

test('a view that overflowed by a tenth and shrinks to nine tenths comes back to 1', () => {
  const c = createCoarsening()
  image(c, 1.1 * CAP)
  const raised = c.factor
  assert.ok(raised > 1, 'it rose on the overflow')
  for (let k = 0; k < 4; k++) image(c, 1.1 * CAP)
  assert.equal(c.factor, raised, 'the view held, the factor held')
  let images = 0
  while (c.factor > 1 && images < 4) {
    image(c, 0.9 * CAP)
    images++
  }
  assert.equal(c.factor, 1, `back to its own threshold in ${images} images`)
  for (let k = 0; k < 8; k++) image(c, 0.9 * CAP)
  assert.equal(c.factor, 1, 'and stays there')
})

test('around the list no image after image flips, whatever law the cut follows', () => {
  for (const law of [1, 2, 3]) {
    const c = createCoarsening()
    let moves = 0
    for (let k = 0; k < 200; k++) moves += Number(image(c, (k % 2 ? 0.97 : 1.03) * CAP, law))
    assert.equal(moves, 1, `law ${law}: one rise, then held`)
    // A still view past the list: one rise, never a try below it.
    const still = createCoarsening()
    let stillMoves = 0
    for (let k = 0; k < 200; k++) stillMoves += Number(image(still, 1.05 * CAP, law))
    assert.equal(stillMoves, 1, `law ${law}, still`)
    assert.ok((1.05 * CAP) / still.factor ** law <= CAP, 'it ends on a cut that fits')
  }
})

test('a view that changed but still overflows tries its own threshold once, and rises back', () => {
  const c = createCoarsening()
  image(c, 1.1 * CAP)
  image(c, 1.1 * CAP)
  assert.equal(image(c, 2 * CAP), true, 'clearly changed: its own threshold tried')
  assert.equal(c.factor, 1)
  assert.equal(image(c, 2 * CAP), true, 'past the list there: raised from its exact ranks')
  assert.equal(c.factor, 2)
  for (let k = 0; k < 8; k++) assert.equal(image(c, 2 * CAP), false, `image ${k}: held`)
})

test('a list grown since releases the factor', () => {
  const c = createCoarsening()
  image(c, 3 * CAP)
  assert.ok(c.factor > 1)
  assert.equal(coarsenAfter(c, CAP, 2 * CAP, false), true)
  assert.equal(c.factor, 1)
})

/** `images` images of a still view whose ask is `own` at its own threshold and `coarse` at any
 *  factor above it — the levels as steps —: a try at its wait's end, and, raised back, the cut
 *  under the factor. The images each try came at. */
function still(c: Coarsening, images: number, own: number, coarse: number) {
  const tries: number[] = []
  for (let k = 1; k <= images; k++) {
    if (!coarsenTick(c)) continue
    tries.push(k)
    if (coarsenAfter(c, own, CAP, own > CAP)) coarsenAfter(c, coarse, CAP, false)
  }
  return tries
}

test('a still view whose own cut fits again, its coarse ask unmoved, comes back after its wait', () => {
  const c = createCoarsening()
  coarsenAfter(c, 1.05 * CAP, CAP, true)
  coarsenAfter(c, 0.5 * CAP, CAP, false)
  assert.ok(c.factor > 1)
  // A tenth of the content streams out: its own ask falls to 0.945, its coarse one does not move.
  assert.equal(coarsenAfter(c, 0.5 * CAP, CAP, false), false, 'nothing the coarse ask can tell')
  assert.deepEqual(still(c, 200, 0.945 * CAP, 0.5 * CAP), [64], 'one try, at the wait’s end')
  assert.equal(c.factor, 1)
})

test('a still view that still overflows tries at doubling waits, up to the longest', () => {
  const c = createCoarsening()
  coarsenAfter(c, 1.05 * CAP, CAP, true)
  coarsenAfter(c, 0.5 * CAP, CAP, false)
  const tries = still(c, 20000, 1.05 * CAP, 0.5 * CAP)
  const waits = tries.map((image, k) => image - (tries[k - 1] ?? 0))
  assert.deepEqual(waits.slice(0, 8), [64, 128, 256, 512, 1024, 2048, 4096, 4096])
  assert.ok(c.factor > 1)
})

test('a narrow overflow whose coarse ask jitters tries its own threshold at the waits alone', () => {
  const c = createCoarsening()
  coarsenAfter(c, 1.01 * CAP, CAP, true)
  const coarse = (k: number) => 0.5 * CAP * (1 + 0.02 * Math.sin(k))
  const tries: number[] = []
  for (let k = 1; k <= 600; k++) {
    // A view that moves a little: a readout at the factor each image, its ask within 2 %.
    if (!coarsenTick(c)) {
      coarsenAfter(c, coarse(k), CAP, false)
      continue
    }
    tries.push(k)
    assert.equal(coarsenAfter(c, 1.01 * CAP, CAP, true), true, 'its own cut still overflows')
  }
  assert.deepEqual(tries, [64, 64 + 128, 64 + 128 + 256])
})
