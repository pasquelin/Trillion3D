import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MeasuredWorld } from '../session/explorer.ts'
import { sessionOptions } from './worldOptions.ts'
import { worldSwitches } from './worldSwitches.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'

/** No frame drawn yet. */
const unseen = { last: null }

/** An open session that records the switches written into it. */
function session(draws = true) {
  const written: boolean[] = []
  let on = draws
  const explorer = {
    setTemporalAntialiasing: (next: boolean) => void (written.push(next), (on = next)),
    temporalAntialiasing: () => on,
  } as unknown as MeasuredWorld
  return { explorer, written }
}

// #363: `createWorld(…, { temporalAntialiasing: false })` opens its sessions with it off, and
// the property flips the open session in place, never reopening it.
test('temporal antialiasing is given to the session and switched in place', () => {
  const open = session(false)
  let renewed = 0,
    invalidated = 0
  const runtime = {
    explorer: null as MeasuredWorld | null,
    renew: () => void renewed++,
    invalidate: () => void invalidated++,
  }
  const options = { temporalAntialiasing: false }
  const switches = worldSwitches(options, () => runtime, unseen)
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, false)
  assert.equal(switches.temporalAntialiasing, false, 'before a session: what the page asked')
  runtime.explorer = open.explorer
  switches.temporalAntialiasing = true
  switches.temporalAntialiasing = true
  assert.deepEqual(open.written, [true], 'written once, into the open session')
  assert.equal(switches.temporalAntialiasing, true, 'read back from the session')
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, true, 'kept on reopen')
  assert.deepEqual([renewed, invalidated], [0, 1])
})

test('temporal antialiasing is on by default and reads as the session draws it', () => {
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({}, () => runtime, unseen)
  assert.equal(switches.held.temporalAntialiasing, true, 'on by default')
  assert.equal(switches.temporalAntialiasing, true, 'before a session: what the page asked')
  runtime.explorer = session(false).explorer
  assert.equal(switches.temporalAntialiasing, false, 'read back from the session')
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
  chain.add(effect.bloom())
  ;(chain.passes[0] as ReturnType<typeof effect.bloom>).radius = 2
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
  assert.equal(sessionOptions({}, switches.held).pixelError, 0, 'the source cut by default')
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
