// Bounced light kept every frame from holding, converged or not, so a still view with it on
// never reached the held frame a capture waits for. Only a series still working keeps it now.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unsettledMask, unsettledReasons } from './unsettled.ts'
import { settledRt } from './hold.fixture.ts'
import { imagesToForget } from '../../lighting/bounce/screen/historyReady.ts'
import { createShadowMobility } from '../../lighting/shadows/casters/mobility.ts'

test('probes still converging keep the frame drawn, a closed series lets it hold', () => {
  const rt = settledRt()
  type Probes = NonNullable<typeof rt.bounce.probes>
  // A bounce is wanted unless the host switched it off (`setWebgpuBounce`): the fixture's state names no such switch.
  rt.bounce.wanted = true
  rt.bounce.probes = { working: true } as unknown as Probes
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes'])
  rt.bounce.probes = { working: false } as unknown as Probes
  assert.equal(unsettledMask(rt), 0, 'a converged series is a steady state')
})

test('probes still being built keep the frame drawn, a refused bounce does not', () => {
  const rt = settledRt()
  rt.bounce.probes = undefined
  rt.bounce.pending = Promise.resolve()
  // A bounce is wanted unless the host switched it off (`setWebgpuBounce`): the fixture's state names no such switch.
  rt.bounce.wanted = true
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['bounceProbes'])
  rt.bounce.wanted = false
  assert.equal(unsettledMask(rt), 0, 'a bounce switched off while rigging is waited for no longer')
  rt.bounce.wanted = true
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

test('screen probes follow a change by blending: a view changed (a tile landed) is drawn till the frames the history holds have passed since', () => {
  const rt = settledRt()
  type Screen = NonNullable<typeof rt.bounce.screen>
  type View = NonNullable<typeof rt.gpu.screenProbes>
  rt.bounce.screen = {
    read: () => ({ values: { screenProbeTemporal: true }, maxFramesAccumulated: 10 }),
  } as unknown as Screen
  rt.gpu.screenProbes = { indirect: {}, frame: 500 } as unknown as View
  assert.equal(unsettledMask(rt), 0, 'a view that never changed, its history whole')
  rt.run.frame = 261
  rt.run.gate.hold.noise.changedAt = 261
  rt.run.frame = 265
  assert.deepEqual(
    unsettledReasons(unsettledMask(rt)),
    ['screenProbes'],
    'four images after the change',
  )
  rt.run.frame = 261 + imagesToForget(10) - 1
  assert.deepEqual(
    unsettledReasons(unsettledMask(rt)),
    ['screenProbes'],
    'the last image before the old light is under a display step',
  )
  rt.run.frame = 261 + imagesToForget(10)
  assert.equal(unsettledMask(rt), 0, 'the history has taken the change in')
})

test('a caster that moved keeps the frame drawn until the frames without a move have turned it static', () => {
  const rt = settledRt()
  const mobility = createShadowMobility()
  const world = new Float64Array(16)
  mobility.ensure(1, () => world)
  ;(rt.lights as { mobility: typeof mobility }).mobility = mobility
  // The shadow maps' cache holds a previous frame's maps: it takes the invalidations that turn a caster static.
  ;(rt.lights as { vsm?: unknown }).vsm = { state: { cache: { acceptsInvalidations: () => true } } }
  assert.equal(unsettledMask(rt), 0, 'a scene that never moved holds')
  const moved = new Float64Array(16)
  moved[12] = 3
  mobility.move(0, moved)
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['casterSettling'])
  for (let frame = 0; frame < 100; frame++) mobility.settle(100)
  assert.deepEqual(
    unsettledReasons(unsettledMask(rt)),
    ['casterSettling'],
    'a hundred frames without a move is not past the threshold',
  )
  mobility.settle(100)
  mobility.settle(100)
  assert.equal(unsettledMask(rt), 0, 'static again: the view may hold')
})
