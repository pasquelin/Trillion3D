// The noise's clock counts the images drawn since the surface cache's light began, zero before, so that a world which drew one image more
// before the start meets the same noise at its hold as one that did not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { beginNoiseImage, noiseFrame } from './noiseFrame.ts'
import { createFrameHold } from '../revisions.ts'
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

/**
 * A runtime on a real held-frame witness. `image` plays one image as the frame entry does: a revision moves between images when `moves` says so, the hold's decision asks the clock
 * (`quiet`), the frame is drawn (a revision moves while it is when `during` says so) and kept; an image that is held is not kept.
 */
const session = (
  moves: (frame: number) => boolean = () => false,
  during: (frame: number) => boolean = () => false,
) => {
  const revisions = { scene: 0, view: 0, resources: 0 }
  const hold = createFrameHold(1)
  const run = { frame: 0, gate: { revisions, hold } }
  const rt = { run, surfaceCache: undefined, lights: undefined } as unknown as WebgpuPagesRuntime
  return {
    rt,
    image(frame: number, quiet = false, drawn = true) {
      run.frame = frame
      if (moves(frame)) revisions.scene++
      const final = beginNoiseImage(rt, quiet)
      const phase = noiseFrame(rt)
      if (drawn) {
        if (during(frame)) revisions.resources++
        hold.keep(revisions)
      }
      return { final, phase }
    },
  }
}
const phasesOf = (world: ReturnType<typeof session>, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => world.image(from + k).phase)

test('the noise turns with every image while the view moves, and counts the images of its establishment once it stands: a world that moved a hundred images and one set there meet the same noise at their hold', () => {
  const moved = session((frame) => frame <= 100),
    posed = session((frame) => frame <= 1)
  assert.deepEqual(phasesOf(moved, 1, 3), [1, 2, 3], 'moving: the clock advances at each image')
  assert.equal(
    phasesOf(moved, 4, 105).at(-1),
    5,
    'five images of establishment after the last move',
  )
  assert.equal(
    phasesOf(posed, 1, 6).at(-1),
    5,
    'the same five, for a world that never moved after its opening',
  )
})

test('a view that moves again restarts its count from the move', () => {
  const world = session((frame) => frame === 10 || frame <= 1)
  assert.equal(phasesOf(world, 1, 12).at(-1), 2, 'two images since the move at 10')
})

test('one change alone is no motion: the image it falls on counts from the change, whatever the images before it', () => {
  const early = session((frame) => frame <= 1 || frame === 10),
    late = session((frame) => frame <= 1 || frame === 50)
  assert.equal(phasesOf(early, 1, 10).at(-1), 0, 'the change at 10 starts a count')
  assert.equal(
    phasesOf(late, 1, 50).at(-1),
    0,
    'the change at 50 starts the same count, though the world is older',
  )
  assert.equal(phasesOf(late, 51, 51).at(-1), 1)
})

test('established at phase 37: one image is drawn at zero, then the view is held', () => {
  const world = session((frame) => frame <= 3)
  assert.equal(phasesOf(world, 1, 40).at(-1), 37, 'established at phase 37')
  assert.deepEqual(
    world.image(41, true),
    { final: true, phase: 0 },
    'the final image meets the canonical phase',
  )
  assert.deepEqual(
    world.image(42, true, false),
    { final: false, phase: 1 },
    'held: nothing more is drawn',
  )
})

test('two worlds of different histories hold the same phase', () => {
  const quick = session((frame) => frame <= 1),
    slow = session((frame) => frame <= 90)
  phasesOf(quick, 1, 5)
  phasesOf(slow, 1, 120)
  assert.deepEqual(quick.image(6, true), { final: true, phase: 0 })
  assert.deepEqual(slow.image(121, true), { final: true, phase: 0 })
})

test('a change after the final image starts a new establishment, and the image that changes asks nothing', () => {
  const world = session((frame) => frame === 1 || frame === 10)
  phasesOf(world, 1, 5)
  assert.equal(world.image(6, true).final, true)
  assert.equal(world.image(9, true).final, false)
  assert.deepEqual(
    world.image(10, true),
    { final: false, phase: 0 },
    'the image that changes asks nothing',
  )
  assert.deepEqual(
    world.image(11, true),
    { final: true, phase: 0 },
    'its establishment ends on a new final image',
  )
})

test('a term unsettled again after the final image: the establishment that follows jumps again', () => {
  const world = session((frame) => frame <= 1)
  phasesOf(world, 1, 5)
  assert.deepEqual(world.image(6, true), { final: true, phase: 0 })
  assert.equal(world.image(7).final, false, 'drawn again, not as a final image')
  assert.equal(world.image(8).final, false)
  assert.deepEqual(
    world.image(9, true),
    { final: true, phase: 0 },
    'the next establishment ends on its own final image',
  )
  assert.equal(world.image(10, true, false).final, false)
})

test('a final image drawn before the light began is not the final one: the establishment that follows jumps again, and the held image meets zero', () => {
  const lighting: { begunAt?: number } = {}
  const world = session()
  Object.assign(world.rt, {
    surfaceCache: { lighting },
    lights: { buffer: {}, store: { unlit: false } },
  })
  world.image(1)
  // Established, but the light that can begin has not: no final image yet, the clock waits at zero.
  assert.deepEqual(world.image(10, true), { final: false, phase: 0 })
  lighting.begunAt = 50
  assert.deepEqual(
    world.image(60, true),
    { final: true, phase: 0 },
    'after the light began: the final image',
  )
  assert.deepEqual(
    world.image(61, true, false),
    { final: false, phase: 1 },
    'then the view is held',
  )
  // A light that begins after an image that was final for the rest: the next establishment jumps again.
  lighting.begunAt = 65
  assert.deepEqual(world.image(70, true), { final: true, phase: 0 })
})

test('a change made while an image was drawn is a change: the clock counts the establishment from the image after it, in every world', () => {
  const late = session(
      () => false,
      (frame) => frame === 30,
    ),
    early = session(
      () => false,
      (frame) => frame === 12,
    )
  assert.equal(
    phasesOf(late, 1, 40).at(-1),
    40 - 31,
    'a tile landed during image 30: the establishment counts from image 31',
  )
  assert.equal(
    phasesOf(early, 1, 40).at(-1),
    40 - 13,
    'and from 13 for one that landed during image 12',
  )
})

test('each view has its own establishment: a side view drawn between two images of the main one does not end the main view’s final image', () => {
  const main = session()
  const gate = main.rt.run.gate as { hold: ReturnType<typeof createFrameHold> }
  const mainHold = gate.hold
  phasesOf(main, 1, 5)
  assert.equal(main.image(10, true).final, true, 'the main view’s final image')
  // The side view is drawn: its own witness is the gate’s meanwhile, and it draws every image (not quiet).
  gate.hold = createFrameHold(1)
  main.rt.run.frame = 11
  assert.equal(beginNoiseImage(main.rt, false), false)
  gate.hold = mainHold
  assert.equal(
    main.image(12, true, false).final,
    false,
    'the main view is held: its final image stands',
  )
})
