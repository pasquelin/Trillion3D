// The factor a view's threshold is cut under past the device's list: it rises on an overflow
// alone, tries the view's own threshold again once the view clearly changed, never twice for a
// still view — whatever the law the cut follows —, and a grown list releases it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { coarsenAfter, createCoarsening, type Coarsening } from './coarsening.ts'

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
