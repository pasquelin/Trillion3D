// The noise's clock counts the images drawn since the surface cache's light began, zero before, so that a world which drew one image more
// before the start meets the same noise at its hold as one that did not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { noiseFrame } from './noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

const world = (frame: number, lighting?: { begunAt?: number } | null, lit = true) =>
  ({
    run: { frame },
    surfaceCache: lighting === null ? undefined : { lighting },
    lights: { buffer: lit ? {} : undefined, store: { unlit: false } },
  }) as unknown as WebgpuPagesRuntime

test('zero before the light begins, the images drawn since after', () => {
  assert.equal(noiseFrame(world(7, {})), 0, 'a cache whose light has not begun')
  assert.equal(noiseFrame(world(7, undefined)), 0, 'a cache with no lighting state yet')
  assert.equal(noiseFrame(world(278, { begunAt: 11 })), 267)
})

test('two worlds, one drawing an image more before the start, share the clock at their hold', () => {
  const cold = world(278, { begunAt: 11 }),
    warm = world(277, { begunAt: 10 })
  assert.equal(noiseFrame(cold), noiseFrame(warm))
})

test('a session with no surface cache follows the image number', () => {
  assert.equal(noiseFrame(world(41, null)), 41)
})

test('a light that can never begin leaves the noise on the image number, not frozen at zero', () => {
  assert.equal(noiseFrame(world(41, {}, false)), 41, 'no light buffer: nothing to light')
  const unlit = world(41, {}) as unknown as { lights: { store: { unlit: boolean } } }
  unlit.lights.store.unlit = true
  assert.equal(noiseFrame(unlit as unknown as WebgpuPagesRuntime), 41, 'a store with no lit light')
  assert.equal(noiseFrame(world(41, {})), 0, 'a light that will begin: zero meanwhile')
})

/** A runtime whose view moves on the images `moves` names; `step` draws image `frame`, as every image asks the clock once or more. */
const session = (moves: (frame: number) => boolean) => {
  const run = { frame: 0, gate: { revisions: {}, hold: { same: () => !moves(run.frame) } } }
  const rt = { run, surfaceCache: undefined, lights: undefined } as unknown as WebgpuPagesRuntime
  return {
    rt,
    step(frame: number) {
      run.frame = frame
      return noiseFrame(rt)
    },
  }
}

test('the noise turns with every image while the view moves, and counts the images of its establishment once it stands: a world that moved a hundred images and one set there meet the same noise at their hold', () => {
  const moved = session((frame) => frame <= 100),
    posed = session((frame) => frame <= 1)
  const phases = [1, 2, 3].map((frame) => moved.step(frame))
  assert.deepEqual(phases, [1, 2, 3], 'moving: the clock advances at each image')
  let last = 0
  for (let frame = 4; frame <= 105; frame++) last = moved.step(frame)
  let other = 0
  for (let frame = 1; frame <= 6; frame++) other = posed.step(frame)
  assert.equal(last, 5, 'five images of establishment after the last move')
  assert.equal(other, 5, 'the same five, for a world that never moved after its opening')
})

test('a view that moves again restarts its count from the move', () => {
  const world = session((frame) => frame === 10 || frame <= 1)
  let phase = 0
  for (let frame = 1; frame <= 12; frame++) phase = world.step(frame)
  assert.equal(phase, 2, 'two images since the move at 10')
})
