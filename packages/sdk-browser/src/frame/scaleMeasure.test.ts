// #831: an 'auto' world that drew through explicit renders before its loop began (`awaitPages`,
// `world.render()`) was never held to measure the display: a page heavy from its first frame read
// half the refresh from its stretched intervals. The loop's first frames measure whatever came first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScaleControl } from './scaleControl.ts'
import { fitting, HZ120, simulate } from './scaleFit.fixture.ts'

/** The non-GPU share of every frame, ms. */
const OTHER = 0.6
/** The last `n` entries of `list`. */
const tail = <T>(list: T[], n: number) => list.slice(list.length - n)

test('explicit renders before the loop, every other refresh: the loop still finds 120 Hz', () => {
  const control = createScaleControl('auto'),
    clock = { now: 0, frame: 0 },
    page = { gpu: (s: number) => 16 * s * s, other: () => OTHER }
  for (let i = 0; i < 12; i++) {
    // `awaitPages`, then `world.render()`: drawn, never held, each image two refreshes.
    control.tick((clock.now += 2 * HZ120), true)
    control.drew(control.wanted(), true)
    control.observe(page.gpu(control.wanted()), control.wanted())
  }
  const { shown, scales } = simulate(control, 600, page, clock)
  assert.ok(Math.abs(control.refreshMs! - HZ120) < 1e-6, `${control.refreshMs}`)
  assert.ok(control.wanted() <= fitting(16, OTHER) && control.wanted() >= fitting(16, OTHER) / 1.04)
  assert.ok(tail(shown, 240).every((n) => n === 1))
  assert.equal(new Set(tail(scales, 240)).size, 1)
})
