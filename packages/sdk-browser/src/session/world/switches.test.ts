import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MeasuredWorld } from '../explorer.ts'
import { sessionOptions } from './options.ts'
import { worldSwitches } from './switches.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { DEFAULT_PIXEL_ERROR } from '../../../../sdk-core/src/lod/policy.ts'

/** No frame drawn yet. */
const unseen = { last: null }

/** An open session that records the switches written into it. */
function session() {
  const written: string[] = []
  const explorer = {
    setTemporalAntialiasing: (next: string) => void written.push(next),
  } as unknown as MeasuredWorld
  return { explorer, written }
}

// #363: `createWorld(…, { temporalAntialiasing: false })` opens its sessions with it off, and
// the property flips the open session in place, never reopening it.
test('temporal antialiasing is given to the session and switched in place', () => {
  const open = session()
  let renewed = 0,
    invalidated = 0
  const runtime = {
    explorer: null as MeasuredWorld | null,
    renew: () => void renewed++,
    invalidate: () => void invalidated++,
  }
  const options = { temporalAntialiasing: false }
  const switches = worldSwitches(options, () => runtime, unseen)
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, 'off')
  assert.equal(switches.temporalAntialiasing, 'off', 'before a session: what the page asked')
  runtime.explorer = open.explorer
  switches.temporalAntialiasing = true
  switches.temporalAntialiasing = 'max'
  assert.deepEqual(open.written, ['max'], 'written once, into the open session')
  assert.equal(switches.temporalAntialiasing, 'max', 'the level resolved, the session open')
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, 'max', 'kept on reopen')
  switches.temporalAntialiasing = 'medium'
  assert.deepEqual(open.written, ['max', 'medium'], 'another level, in place')
  assert.deepEqual([renewed, invalidated], [0, 2])
  assert.throws(() => (switches.temporalAntialiasing = 'fine' as never), /temporalAntialiasing/)
})

test("a scene's level sits below the preset and the page, the first scene naming one deciding", () => {
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({}, () => runtime, unseen)
  switches.sceneTemporalAntialiasing('low')
  switches.sceneTemporalAntialiasing('high')
  assert.equal(switches.temporalAntialiasing, 'low', 'the first scene decides')
  switches.quality.preset = 'fine'
  assert.equal(switches.temporalAntialiasing, 'high', "the preset's level over the scene's")
  switches.quality.preset = 'max'
  assert.equal(switches.temporalAntialiasing, 'low', 'max writes nothing: the scene shows again')
  const page = worldSwitches({ temporalAntialiasing: true }, () => runtime, unseen)
  page.sceneTemporalAntialiasing('off')
  assert.equal(page.temporalAntialiasing, 'max', "the page's true holds over the scene's off")
})

test('temporal antialiasing is at its finest level by default, the level resolved read back', () => {
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({}, () => runtime, unseen)
  assert.equal(switches.held.temporalAntialiasing, 'max', 'the finest level by default')
  assert.equal(switches.temporalAntialiasing, 'max', 'before a session: what the page asked')
  runtime.explorer = session().explorer
  assert.equal(switches.temporalAntialiasing, 'max', 'a session open: the level resolved still')
  // Undefined gives the setting back to the preset and the scene.
  switches.temporalAntialiasing = 'low'
  switches.temporalAntialiasing = undefined
  assert.equal(switches.temporalAntialiasing, 'max')
})

// #349: `world.effects` is one chain for the world's life, handed to every session it opens; a
// change of it asks for a frame, and reopens nothing.
test('the effect chain is given to every session, and a change of it asks for a frame', () => {
  let renewed = 0,
    invalidated = 0
  const runtime = {
    explorer: null as MeasuredWorld | null,
    renew: () => void renewed++,
    invalidate: () => void invalidated++,
  }
  const switches = worldSwitches({}, () => runtime, unseen)
  const chain = switches.held.effects
  assert.equal(sessionOptions({}, switches.held).effects, chain)
  assert.deepEqual([chain.size, chain.passes[0]?.kind, invalidated], [1, 'bloom', 0], 'a start')
  chain.add(effect.bloom())
  ;(chain.passes[0] as ReturnType<typeof effect.bloom>).sizeScale = 2
  assert.equal(sessionOptions({}, switches.held).effects, chain, 'the same chain on reopen')
  assert.deepEqual([invalidated, renewed], [2, 0])
})

// S32: the page's switches are settings of the world's registry, at the page's priority; each is
// written into the open session once its resolved value changes, and no preset overwrites it.
test('the screen error and the bounce are the page’s settings, applied once each', () => {
  const errors: number[] = []
  const explorer = {
    setPixelError: (value: number) => void errors.push(value),
    setBounce() {},
  } as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({}, () => runtime, unseen)
  assert.equal(
    sessionOptions({}, switches.held).pixelError,
    DEFAULT_PIXEL_ERROR,
    'the balanced cut by default',
  )
  runtime.explorer = explorer
  switches.pixelError = 2
  switches.pixelError = 2
  assert.deepEqual(errors, [2], 'written once, into the open session')
  assert.equal(sessionOptions({}, switches.held).pixelError, 2, 'kept on reopen')
  switches.bounce = true
  switches.settings.set('bounce', false, 'quality')
  assert.equal(switches.bounce, true, 'a preset does not overwrite the page')
})

test('the resolution asked at creation is the render scale, unless the page gives one', () => {
  const runtime = { explorer: null, renew() {}, invalidate() {} }
  const made = (options: Parameters<typeof worldSwitches>[0]) =>
    worldSwitches(options, () => runtime, unseen).held
  assert.equal(made({}).renderScale, 'auto')
  assert.equal(made({ quality: { resolution: { mode: 'fast' } } }).renderScale, 0.5)
  assert.equal(made({ renderScale: 1, quality: { resolution: { mode: 'fast' } } }).renderScale, 1)
})
