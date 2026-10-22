// Bounced light kept every frame from holding, converged or not, so a still view with it on
// never reached the held frame a capture waits for. Only a series still working keeps it now.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unsettledMask, unsettledReasons } from './unsettled.ts'
import { settledRt } from './hold.fixture.ts'

test('probes still converging keep the frame drawn, a closed series lets it hold', () => {
  const rt = settledRt()
  type Probes = NonNullable<typeof rt.bounce.probes>
  rt.bounce.probes = { working: true } as unknown as Probes
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes'])
  rt.bounce.probes = { working: false } as unknown as Probes
  assert.equal(unsettledMask(rt), 0, 'a converged series is a steady state')
})

test('probes still being built keep the frame drawn, a refused bounce does not', () => {
  const rt = settledRt()
  rt.bounce.probes = undefined
  rt.bounce.pending = Promise.resolve()
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes'])
  rt.bounce.reason = 'bounce unavailable'
  assert.equal(unsettledMask(rt), 0, 'a bounce that will never come is a steady state')
})

test('screen probes still building their history keep the frame drawn, a whole one or an image that cast none does not', () => {
  const rt = settledRt()
  type Screen = NonNullable<typeof rt.bounce.screen>
  type View = NonNullable<typeof rt.gpu.screenProbes>
  const settings = { values: { screenProbeTemporal: true }, maxFramesAccumulated: 10 }
  rt.bounce.screen = { read: () => settings } as unknown as Screen
  const view = { indirect: {}, frame: 3 }
  rt.gpu.screenProbes = view as unknown as View
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['screenProbes'])
  view.frame = 10
  assert.equal(unsettledMask(rt), 0, 'a history of the frames it holds at most is a steady state')
  view.frame = 3
  settings.values.screenProbeTemporal = false
  assert.equal(unsettledMask(rt), 0, 'a history that is not temporal is never built')
  settings.values.screenProbeTemporal = true
  view.indirect = undefined as unknown as object
  assert.equal(unsettledMask(rt), 0, 'an image that cast no probe leaves nothing to wait for')
})
