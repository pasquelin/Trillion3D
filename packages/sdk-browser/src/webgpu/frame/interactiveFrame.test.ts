// A light that lands on an unlit view starts the lit program's compile; until it lands, the frame is
// held (`deviceAnswer`), never drawn with the unlit stand-in, and its arrival asks the lit frame
// (#370, #536, #1362). Real bricks: `pendingWebgpuFrame`, the deferred lighting, the hold.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { pendingWebgpuFrame } from './interactiveFrame.ts'
import { deviceAnswering } from './deviceAnswer.ts'
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import { wantsContractLighting } from '../pages/prepare/lightResources.ts'
import { directLightResources } from '../pages/prepare/contractLight.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { deferredLightingHarness, settledRt, surface, view } from './hold.fixture.ts'

installGpuGlobals()

/** An unlit view drawn once, then a light turned on: frames asked while the lit program compiles. */
async function lightTurnedOn() {
  const h = deferredLightingHarness()
  const rt = settledRt()
  const store = {
    count: 0,
    // Bumped by every light added, as the engine's store does (`lightKinds` reads it per epoch).
    epoch: 1,
    unlit: true,
    packed: new Float32Array(64),
    sliceOf: () => -1,
    kindOf: () => 0,
  }
  Object.assign(rt.lights, { store })
  // The wiring of `../pages/prepare/preparePages.ts`: an arrived program breaks the hold.
  const lighting = await createDeferredLighting(h.device, () => rt.run.gate.resourcesChanged())
  rt.gpu.deferred = lighting
  let drawn = 0
  /** `renderWebgpuPages` reduced to its two outcomes: the frame held, or encoded and kept. */
  const render = () => {
    if (holdWebgpuFrame(rt, h.device)) return false
    const lit = wantsContractLighting(rt)
    // The resources the engine binds: the program the frame binds is the one the hold awaits.
    lighting.bind(surface, view(), view(), lit, directLightResources(rt), () => {})
    drawn++
    keepWebgpuFrame(rt)
    return true
  }
  assert.equal(render(), true, 'the unlit view draws at once')
  Object.assign(store, { count: 1, unlit: false, epoch: 2 })
  rt.run.gate.sceneChanged()
  for (let frame = 0; frame < 4; frame++) assert.equal(render(), false, 'held while compiling')
  assert.equal(drawn, 1, 'no frame is drawn with the unlit stand-in while the lit view is wanted')
  assert.equal(lighting.usesContract, false)
  assert.equal(deviceAnswering(rt), true, 'the lit program is what the frame waits for')
  return { h, rt, lighting, render, answer: pendingWebgpuFrame(rt) }
}

test('a frame held on the lit program is drawn lit once it lands', async () => {
  const { h, rt, lighting, render, answer } = await lightTurnedOn()
  h.finishCompilation()
  assert.equal(await answer, true, 'the arrived program asks its frame')
  assert.equal(deviceAnswering(rt), false)
  assert.equal(render(), true)
  assert.equal(lighting.usesContract, true, 'the first frame drawn after the light is lit')
})

test('a lit program that fails to compile lets the unlit view by, never holds for ever', async () => {
  const { h, rt, lighting, render, answer } = await lightTurnedOn()
  h.failCompilation()
  assert.equal(await answer, true, 'the failed compile asks one frame')
  // Its stand-ins compile in its place and fail the same way, each failure asking one frame
  // (`contractVariants.ts`, `standIn`): the wait ends with the last of them.
  for (let turn = 0; turn < 4 && deviceAnswering(rt); turn++)
    assert.equal(await pendingWebgpuFrame(rt), true)
  assert.equal(deviceAnswering(rt), false, 'nothing is awaited any more')
  assert.equal(render(), true)
  assert.equal(lighting.usesContract, false, 'the failure is said and the unlit view drawn')
})
