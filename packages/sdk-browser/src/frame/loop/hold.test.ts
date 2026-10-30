// A held frame cannot hide the arrival of a contract program.
//
// `holdWebgpuFrame` holds the frame as long as the three revisions and the signature have not
// moved. Compilation of the deferred lighting program finishes between two frames, without any
// step writing it: as long as its arrival incremented no revision, two identical frames froze
// the raw albedo of `unlit` until a foreign invalidation. The `onReady` callback of
// `createDeferredLighting` repairs that at the origin of the change, and that is what this file
// proves with the real bricks: `createDeferredLighting`, `run.gate.resourcesChanged`,
// `holdWebgpuFrame`, `keepWebgpuFrame`. `rt` is mounted by hand, reduced to what `frameSettled`
// reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { heldOnAnswer, lastHold } from './deviceAnswer.fixture.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import type { DirectLightResources } from '../../lighting/deferred/program.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import {
  deferredLightingHarness,
  drawFinalImage,
  settledRt,
  surface,
  view,
} from './hold.fixture.ts'
import { directLightResources } from '../prepare/contractLight.ts'
import { heldCompiles, track } from '../../lighting/deferred/compileLedger.ts'
import { advanceImageNumber } from './imageNumber.ts'

installGpuGlobals()

test('GEO-02: the contract program that finishes compiling breaks the held frame', async () => {
  const h = deferredLightingHarness()
  const rt = settledRt()
  // The wiring of `../prepare/preparePages.ts`, word for word.
  const lighting = await createDeferredLighting(h.device, () => rt.run.gate.resourcesChanged())
  rt.gpu.deferred = lighting

  // The frame binds what the hold asks the lit program for (`contractLight.ts`), the engine's own
  // resources: one program asked, whose arrival is one resource. A hand-written key that differs
  // in one cut (the lobes) asks a second program, and each arrival bumped the revision.
  const direct = directLightResources(rt)
  // Two identical real frames: DIRECT compilation is started, `unlit` renders while waiting.
  for (let i = 0; i < 2; i++) {
    lighting.bind(surface, view(), view(), true, direct, () => {})
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  assert.equal(lighting.usesContract, false, 'compilation starts, the render stays unlit')
  assert.equal(rt.run.gate.hold.stable, true, 'two identical frames in a row arm the hold')
  // Holding during compilation remains right: nothing has changed the frame yet.
  assert.equal(holdWebgpuFrame(rt, h.device), true)
  const frameTenue = rt.run.frame

  // The program arrives: the callback increments resources and breaks the hold.
  const ressources = rt.run.gate.revisions.resources
  h.finishCompilation()
  await lighting.settle()
  assert.equal(rt.run.gate.revisions.resources, ressources + 1, 'the arrived program is a resource')
  assert.equal(holdWebgpuFrame(rt, h.device), false, 'the next frame is remade')
  assert.equal(rt.run.frameHeld, false)

  // The remade frame adopts the contract program: the declared light finally lights.
  lighting.bind(surface, view(), view(), true, direct, () => {})
  rt.run.frame++
  keepWebgpuFrame(rt)
  assert.equal(lighting.usesContract, true, 'contract draws the frame after arrival')
  assert.equal(rt.run.frame, frameTenue + 1)
  keepWebgpuFrame(rt)
  drawFinalImage(rt, h.device)
  assert.equal(holdWebgpuFrame(rt, h.device), true, 'the contract frame is held once remade')
})

test('GEO-02: both contract variants announce their arrival, DIRECT as well as BOUNCE', async () => {
  const h = deferredLightingHarness()
  let arrivees = 0
  const lighting = await createDeferredLighting(h.device, () => arrivees++)
  const bounce = { lights: {}, bounceGrid: {}, probes: {} } as unknown as DirectLightResources
  lighting.bind(surface, view(), view(), true, { lights: {} as GPUBuffer }, () => {})
  lighting.bind(surface, view(), view(), true, bounce, () => {})
  assert.equal(arrivees, 0, 'nothing is announced while both compilations last')
  h.finishCompilation()
  await lighting.settle()
  assert.equal(arrivees, 2, 'DIRECT and BOUNCE each announce theirs')
})

test('a frame held on a compile in flight is no image: a world that compiles meanwhile ends at the image number of one that did not', () => {
  const h = deferredLightingHarness()
  const warm = settledRt(),
    cold = settledRt()
  warm.gpu.device = cold.gpu.device = h.device
  // The warm world holds its still frame once; the cold one first meets a program its frames wait for, and is asked three times.
  let arrives!: () => void
  track(h.device, new Promise<void>((resolve) => (arrives = resolve)), true)
  /** A frame entry that holds: the hold, then the frame entry's number (`renderWebgpuPages`). */
  const entry = (rt: typeof cold) => {
    const held = holdWebgpuFrame(rt, h.device)
    advanceImageNumber(rt.run, held)
    return held
  }
  for (let i = 0; i < 3; i++) {
    assert.equal(entry(cold), true, 'held on the answer')
    assert.equal(cold.run.frameHeld, false, 'not the still frame the page waits for')
  }
  assert.equal(cold.run.frame, 0, 'three frames held on an answer advanced no image')
  arrives()
  return Promise.resolve().then(() => {
    keepWebgpuFrame(cold)
    keepWebgpuFrame(warm)
    entry(cold)
    entry(warm)
    assert.equal(cold.run.frame, warm.run.frame, 'the same image number once the program is there')
  })
})

test('a frame held on targets the device has not granted draws nothing: it is no still frame and advances no image', () => {
  const h = deferredLightingHarness()
  const rt = settledRt()
  rt.gpu.device = h.device
  ;(rt.gpu as { targetGrant?: unknown }).targetGrant = { mode: 'held' }
  for (let i = 0; i < 3; i++) {
    const held = holdWebgpuFrame(rt, h.device)
    advanceImageNumber(rt.run, held)
    assert.equal(held, true, 'held on the grant')
    assert.equal(rt.run.heldEmpty, true, 'it drew no image')
  }
  assert.equal(rt.run.frame, 0, 'three frames held on a grant advanced no image')
})

test('a run of held frames shows first before last, although none advances the image number', () => {
  const h = deferredLightingHarness()
  const rt = settledRt()
  rt.gpu.device = h.device
  ;(rt.gpu as { targetGrant?: unknown }).targetGrant = { mode: 'held' }
  for (let i = 0; i < 3; i++) holdWebgpuFrame(rt, h.device)
  const [total] = Object.values(lastHold(rt)!.byReason)
  assert.deepEqual([total!.count, total!.first, total!.last], [3, 1, 3])
  assert.equal(lastHold(rt)!.entered, 3)
})

test('a frame held on a compile in flight names what it waits for', async () => {
  const h = deferredLightingHarness()
  const rt = settledRt()
  rt.gpu.device = h.device
  let arrives!: () => void
  track(h.device, new Promise<void>((resolve) => (arrives = resolve)), true, 'lit program')
  assert.equal(holdWebgpuFrame(rt, h.device), true, 'held on the answer')
  assert.deepEqual(heldCompiles(h.device), ['lit program'])
  assert.equal(
    heldOnAnswer(rt),
    'pipelines: lit program',
    'the answer the frame was held on, and the pipeline named',
  )
  assert.deepEqual(
    [lastHold(rt)?.drawn, lastHold(rt)?.reason, lastHold(rt)?.heldEmpty],
    [false, 'pipelines: lit program', true],
    'said as the frame that entered',
  )
  arrives()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(heldCompiles(h.device), [])
  assert.equal(holdWebgpuFrame(rt, h.device), false, 'drawn once it answered')
  assert.equal(heldOnAnswer(rt), undefined, 'and held on none')
  assert.deepEqual([lastHold(rt)?.drawn, lastHold(rt)?.reason], [true, 'drawn'])
  assert.deepEqual(
    Object.entries(lastHold(rt)!.byReason).map(([reason, { count }]) => [reason, count]),
    [
      ['pipelines: lit program', 1],
      ['drawn', 1],
    ],
    'every frame that entered, counted by what was done with it',
  )
})

test('the light beginning is a change of the noise’s clock: the image is drawn although the gate stands, and the establishment goes on to its final image', () => {
  const { device } = deferredLightingHarness()
  const rt = settledRt()
  const lighting: { begunAt?: number } = {}
  Object.assign(rt, { surfaceCache: { lighting, settings: {} } })
  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  assert.equal(holdWebgpuFrame(rt, device), false, 'the light has not begun: drawn')
  rt.run.frame++
  keepWebgpuFrame(rt)
  lighting.begunAt = rt.run.frame
  assert.equal(
    holdWebgpuFrame(rt, device),
    false,
    'it began: a change, drawn though nothing else moved',
  )
  rt.run.frame++
  keepWebgpuFrame(rt)
  drawFinalImage(rt, device)
  assert.equal(holdWebgpuFrame(rt, device), true, 'established: held')
})
