// The shadow raster's time budget is one more budget of the render scale's heuristic
// (`dynamicResolution.ts`, `shadowDynamicResolutionTimeBudgetMs`): its fraction, 1 to 0, is fitted to the
// GPU time of the shadow raster's passes, `observe`'s fifth argument; the shadows throttle their maps by
// what it gives up (`lighting/shadows/vsm/throttle.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { HZ120, refreshControl } from './scaleFit.fixture.ts'
import { NO_TIMING } from './dynamicResolution.ts'

/** An 'auto' control past its refresh measure, the shadow raster's budget 4 ms, and its images: each
 *  takes 1 ms on the GPU in all, `vsmMs` for the shadow raster, drawn at the fractions in force. */
function budgeted() {
  const control = refreshControl('auto'),
    clock = { now: 0 }
  for (let i = 0; i < 8; i++) {
    control.tick((clock.now += HZ120), true)
    control.hold()
  }
  control.vsm.ask(4)
  const image = (vsmMs: number, steered = true) => {
    control.tick((clock.now += HZ120), true)
    control.drew(control.wanted(), true)
    control.observe(1, control.wanted(), steered, NO_TIMING, vsmMs)
    return control.vsm.now
  }
  return { control, image }
}

test('the shadow raster’s fraction moves as the edge scale does, on a linear model, from 0 to 1', () => {
  const { control, image } = budgeted(),
    vsm = Array.from({ length: 18 }, () => image(8))
  assert.deepEqual(vsm.slice(0, 8), Array(8).fill(1), 'the first time ignored, then 8 images')
  // The budget less its 5 %, over the time, times the fraction in force.
  assert.ok(Math.abs(vsm[8] - 3.8 / 8) < 1e-12, `${vsm[8]}`)
  assert.equal(vsm[15], vsm[8], 'and no other change for 8 images')
  assert.ok(vsm[17] < vsm[8], 'lower again')
  assert.equal(control.wanted(), 1, 'the render scale, on its own budget, stays whole')
  assert.equal(control.vsm.ask(0), 1, 'a budget of 0 or less: none, what it learnt kept')
  assert.equal(control.vsm.ask(4), vsm[17])
  assert.equal(image(8, false), vsm[17], 'an image off the controller’s scale is not recorded')
})

test('a budget not named fits nothing, a time of no timing is left out, a time of 0 asks for the most', () => {
  const none = budgeted()
  none.control.vsm.ask(0)
  for (let i = 0; i < 12; i++) assert.equal(none.image(8), 1, 'no budget: the fraction stays 1')
  const lowered = () => {
    const b = budgeted()
    for (let i = 0; i < 9; i++) b.image(8)
    assert.ok(b.control.vsm.now < 1)
    return b
  }
  const unmeasured = lowered()
  const low = unmeasured.control.vsm.now
  for (let i = 0; i < 12; i++) assert.equal(unmeasured.image(NO_TIMING), low, 'left out')
  const zero = lowered()
  for (let i = 0; i < 12; i++) zero.image(0)
  assert.equal(zero.control.vsm.now, 1, 'a time of 0: the most, as the reference gives it')
})

test('whatever the time, a fraction stays within the range any budget keeps: 0.01 at the least', () => {
  const { control, image } = budgeted()
  for (let i = 0; i < 60; i++) image(1e6)
  assert.equal(control.vsm.now, 0.01, 'never 0: a time of 0 after it is not 0 times infinity')
  for (let i = 0; i < 60; i++) image(0)
  assert.equal(control.vsm.now, 1)
})

test('the history is forgotten with the render scale’s: the fraction is back at 1', () => {
  const { control, image } = budgeted()
  for (let i = 0; i < 9; i++) image(8)
  assert.ok(control.vsm.now < 1)
  control.set({ min: 0.5, max: 1 })
  assert.equal(control.vsm.now, 1)
})
