// The noise's clock counts the images drawn since the surface cache's light began, zero before, so that a world which drew one image more
// before the start meets the same noise at its hold as one that did not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { beginNoiseImage, noiseFrame } from './noiseFrame.ts'
import { isFinalImage } from './finalImage.ts'
import { createFrameHold } from '../revisions.ts'
import { createTaaFrameState, STOCHASTIC_SLOTS } from '../../post/taa/frameState.ts'
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
  const taa = createTaaFrameState(),
    mode = { accumulating: true }
  const gpu = { temporal: { frame: taa } }
  const rt = {
    run,
    gpu,
    surfaceCache: undefined,
    lights: undefined,
  } as unknown as WebgpuPagesRuntime
  return {
    rt,
    mode,
    image(frame: number, quiet = false, drawn = true) {
      run.frame = frame
      if (moves(frame)) revisions.scene++
      const final = beginNoiseImage(rt, quiet, mode.accumulating)
      const phase = noiseFrame(rt)
      if (drawn) {
        taa.stochasticSample++
        if (during(frame)) revisions.resources++
        hold.keep(revisions)
      }
      return { final, phase }
    },
  }
}
const phasesOf = (world: ReturnType<typeof session>, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => world.image(from + k).phase)

test('the noise turns with every image while the view moves, and counts from the last change once the view has been calm for a cycle: a world that moved a hundred images and one set there meet the same noise at their hold', () => {
  const moved = session((frame) => frame <= 100),
    posed = session((frame) => frame <= 1)
  assert.deepEqual(
    phasesOf(moved, 1, 3),
    [0, 1, 2],
    'moving: the clock advances at each image from the start of the burst',
  )
  const afterMove = phasesOf(moved, 4, 100 + STOCHASTIC_SLOTS + 5)
  assert.equal(
    afterMove[100 + STOCHASTIC_SLOTS - 1 - 4],
    100 + STOCHASTIC_SLOTS - 2,
    'within the cycle after the last change: no break, still counted from the burst’s start',
  )
  assert.equal(afterMove.at(-1), STOCHASTIC_SLOTS + 5, 'past it, counted from the last change')
  assert.equal(
    phasesOf(posed, 1, 1 + STOCHASTIC_SLOTS + 5).at(-1),
    STOCHASTIC_SLOTS + 5,
    'the same, for a world that never moved after its opening',
  )
})

test('a view that changes every other image meets every phase of the cycle and never a short one', () => {
  const world = session((frame) => frame % 2 === 0)
  const phases = phasesOf(world, 1, 40)
  assert.deepEqual(
    phases,
    Array.from({ length: 40 }, (_, k) => k),
    'the index advances at every image, calm or not',
  )
  assert.equal(new Set(phases.map((phase) => phase % STOCHASTIC_SLOTS)).size, STOCHASTIC_SLOTS)
})

test('a change followed by a calm cycle counts from itself, whatever the images before it', () => {
  const early = session((frame) => frame <= 1 || frame === 10),
    late = session((frame) => frame <= 1 || frame === 50)
  assert.equal(phasesOf(early, 1, 10 + STOCHASTIC_SLOTS + 3).at(-1), STOCHASTIC_SLOTS + 3)
  assert.equal(phasesOf(late, 1, 50 + STOCHASTIC_SLOTS + 3).at(-1), STOCHASTIC_SLOTS + 3)
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
  phasesOf(quick, 1, 10)
  phasesOf(slow, 1, 120)
  assert.deepEqual(quick.image(11, true), { final: true, phase: 0 })
  assert.deepEqual(slow.image(121, true), { final: true, phase: 0 })
})

test('a change after the final image starts a new establishment: its images are drawn within the cycle, and it ends on a new final image', () => {
  const world = session((frame) => frame === 1 || frame === 30)
  phasesOf(world, 1, 9)
  assert.deepEqual(world.image(10, true), { final: true, phase: 0 })
  assert.equal(world.image(29, true, false).final, false)
  assert.deepEqual(
    world.image(30, true),
    { final: false, phase: 0 },
    'the image that changes asks nothing, and counts from itself',
  )
  assert.deepEqual(
    world.image(31, true),
    { final: true, phase: 1 },
    'drawn for the clock, within the cycle: no break',
  )
  for (let frame = 32; frame < 30 + STOCHASTIC_SLOTS; frame++) world.image(frame, true)
  assert.deepEqual(
    world.image(30 + STOCHASTIC_SLOTS, true),
    { final: true, phase: 0 },
    'a new final image',
  )
})

test('a term unsettled again after the final image: the establishment that follows jumps again', () => {
  const world = session((frame) => frame <= 1)
  phasesOf(world, 1, 9)
  assert.deepEqual(world.image(10, true), { final: true, phase: 0 })
  assert.equal(world.image(11).final, false, 'drawn again, not as a final image')
  assert.equal(world.image(12).final, false)
  assert.deepEqual(
    world.image(13, true),
    { final: true, phase: 0 },
    'the next establishment ends on its own final image',
  )
  assert.equal(world.image(14, true, false).final, false)
})

test('a final image drawn before the light began is not the final one: the establishment that follows jumps again, and the held image meets zero', () => {
  const lighting: { begunAt?: number } = {}
  const world = session()
  Object.assign(world.rt, {
    surfaceCache: { lighting },
    lights: { buffer: {}, store: { unlit: false } },
  })
  // A cycle of images over, established, but the light that can begin has not: no final image yet, the clock waits at zero.
  phasesOf(world, 1, 9)
  assert.deepEqual(world.image(10, true), { final: false, phase: 0 })
  lighting.begunAt = 50
  // The light beginning is a change: its establishment goes through a cycle of the noise, then ends on the final image.
  assert.deepEqual(world.image(60, true), { final: false, phase: 0 })
  for (let frame = 61; frame < 60 + STOCHASTIC_SLOTS; frame++) world.image(frame, true)
  assert.deepEqual(
    world.image(60 + STOCHASTIC_SLOTS, true),
    { final: true, phase: 0 },
    'after the light began: the final image',
  )
  assert.deepEqual(
    world.image(61 + STOCHASTIC_SLOTS, true, false),
    { final: false, phase: 1 },
    'then the view is held',
  )
  // A light that begins after an image that was final for the rest: the next establishment jumps again.
  lighting.begunAt = 90
  assert.deepEqual(world.image(100, true), { final: true, phase: 0 })
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
  phasesOf(main, 1, 9)
  assert.equal(main.image(10, true).final, true, 'the main view’s final image')
  // The side view is drawn: its own witness is the gate’s meanwhile, and it draws every image (not quiet).
  gate.hold = createFrameHold(1)
  main.rt.run.frame = 11
  assert.equal(beginNoiseImage(main.rt, false, true), false)
  gate.hold = mainHold
  assert.equal(
    main.image(12, true, false).final,
    false,
    'the main view is held: its final image stands',
  )
})

test('a view with no temporal pass has no cycle to go through: its final image follows its last change at once', () => {
  const world = session((frame) => frame <= 1)
  world.mode.accumulating = false
  phasesOf(world, 1, 2)
  assert.deepEqual(world.image(3, true), { final: true, phase: 0 })
  assert.equal(world.image(4, true, false).final, false)
})

test('the temporal pass turning on is a change of the noise: its cycle counts from it', () => {
  const world = session((frame) => frame <= 1)
  world.mode.accumulating = false
  phasesOf(world, 1, 20)
  assert.deepEqual(
    world.image(21, true),
    { final: true, phase: 0 },
    'no cycle without a temporal pass',
  )
  world.mode.accumulating = true
  assert.deepEqual(
    world.image(22, true),
    { final: false, phase: 0 },
    'the image it turns on asks nothing',
  )
  for (let frame = 23; frame < 22 + STOCHASTIC_SLOTS; frame++) {
    world.image(frame, true)
    assert.equal(
      isFinalImage(world.rt.run),
      false,
      'drawn within the cycle, not as the final image',
    )
  }
  assert.deepEqual(world.image(22 + STOCHASTIC_SLOTS, true), { final: true, phase: 0 })
})

test('an isolated change counts from itself, whatever the images before it', () => {
  const early = session((frame) => frame <= 1 || frame === 20),
    late = session((frame) => frame <= 1 || frame === 80)
  assert.equal(phasesOf(early, 1, 20).at(-1), 0)
  assert.equal(phasesOf(late, 1, 80).at(-1), 0)
})

test('a term unsettled again after the final image continues the index from it, without a jump', () => {
  const world = session((frame) => frame <= 1)
  phasesOf(world, 1, STOCHASTIC_SLOTS + 1)
  assert.deepEqual(world.image(STOCHASTIC_SLOTS + 2, true), { final: true, phase: 0 })
  assert.deepEqual(world.image(STOCHASTIC_SLOTS + 3), { final: false, phase: 1 })
  assert.deepEqual(world.image(STOCHASTIC_SLOTS + 4), { final: false, phase: 2 })
})

test('the light beginning drops the temporal history, accumulated on a noise frozen at zero, and is a change', () => {
  const lighting: { begunAt?: number } = {}
  const world = session()
  Object.assign(world.rt, {
    surfaceCache: { lighting },
    lights: { buffer: {}, store: { unlit: false } },
  })
  const taa = world.rt.gpu.temporal!.frame
  phasesOf(world, 1, 20)
  taa.hasHistory = true
  taa.accumulated = 22
  lighting.begunAt = 20
  const next = world.image(21, true)
  assert.equal(taa.hasHistory, false, 'the history starts again')
  assert.equal(next.final, false, 'a change: no final image on it')
})
