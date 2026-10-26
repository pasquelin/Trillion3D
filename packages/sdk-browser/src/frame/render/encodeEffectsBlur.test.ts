// The motion blur and the depth of field through the effects chain: the velocity stage they need, and what draws.
import { createGraphFrame } from './graphFrame.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import { effectsMoved, encodeLitEffects, encodeResolvedEffects } from './encodeEffects.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { drawing } from './encodeEffects.fixture.ts'
import { resolveFrame } from './effectsFrame.ts'
import { beginTaaFrame } from '../../post/taa/frame.ts'
import { beginCamera } from '../backend/state/previousCamera.ts'
import { encodeVelocity } from '../../post/taa/velocityFrame.ts'
import { TAA_VIEW } from '../../post/taa/bindingsWgsl.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { wordsOf } from '../../post/effects/webgpuEffects.fixture.ts'

/** A view on a kit device, its temporal pass off, its lit image `lit`: what the velocity stage reads, and the camera. */
function untemporal(chain: EffectChain) {
  const kit = fakeDevice(),
    { device } = kit
  const rt = drawing(chain)
  const lit = device
    .createTexture({ size: [8, 4], format: 'rgba16float', usage: 0x14 })
    .createView()
  const storage = () => device.createBuffer({ size: 64, usage: 0x80 })
  Object.assign(rt.gpu, {
    device,
    temporalLevel: 'off',
    hdrView: lit,
    depthView: device
      .createTexture({ size: [8, 4], format: 'depth32float', usage: 0x14 })
      .createView(),
    cache: { buffer: storage() },
  })
  const ids = device.createTexture({ size: [8, 4], format: 'r32uint', usage: 0x14 }).createView()
  Object.assign(rt.vis, {
    visView: ids,
    pageTable: storage(),
    concatPos: storage(),
    concatUv: storage(),
    concatNrm: ids,
    rasters: NO_RASTERS,
    graphFrame: createGraphFrame(),
    materialTable: { displaced: { count: 0 }, view: ids },
    textures: { color: { views: [{}, {}, {}], pages: { buffer: storage() } } },
    mapsSampler: {},
  })
  // The cut's records and the poses the last drawn frame drew, which the velocity measures the
  // placements' motion from (`previousPoses.ts`).
  const records = device
    .createTexture({ size: [8, 4, 1], format: 'rgba32uint', usage: 0x14 })
    .createView({ dimension: '2d-array' })
  Object.assign(rt.run, {
    gpuSelection: { worlds: records, previous: records, posesMoving: false },
  })
  const cam = {
    viewProjection: Float64Array.from(IDENTITY_MATRIX4),
    projection: Float64Array.from(IDENTITY_MATRIX4),
    eye: [0, 0, 0],
    perspective: 1,
    near: 0.1,
  } as unknown as EngineCamera
  /** One image: its entry, the velocity stage, then the passes on the resolved (or `lit`) image. */
  const image = (stage: 'resolved' | 'lit' = 'resolved') => {
    beginTaaFrame(rt, cam)
    rt.run.frame++
    beginCamera(rt, cam) // as the lighting does before the velocity stage
    rt.gpu.effectsRevision = rt.context.effects!.revision // the chain, as `encodeEffects` keeps it
    const encoder = device.createCommandEncoder()
    encodeVelocity(rt, device, encoder, cam)
    return stage === 'lit'
      ? encodeLitEffects(rt, device, encoder, cam)
      : encodeResolvedEffects(rt, device, encoder, undefined, cam)
  }
  return { rt, cam, lit, image, dispatched: () => dispatchedEntries(kit.dispatches) }
}

test('with the temporal pass off, the motion blur has its motion measured by the velocity stage, and blurs the lit image', async () => {
  const { rt, cam, lit, image, dispatched } = untemporal(new EffectChain().add(effect.motionBlur()))
  assert.equal(image(), undefined, 'drawn unblurred while the blur compiles')
  await pipelinesSettled(rt.gpu.device)
  await rt.gpu.effects!.settled()
  const velocity = rt.gpu.velocity!
  const view = () => wordsOf(velocity.uniform)
  assert.equal(image(), undefined, 'a still image is left as it is: no streak, no pass')
  assert.ok(dispatched().includes('surfaceVelocity'), 'the stage measures the image once compiled')
  cam.viewProjection[12] = 0.25
  assert.equal(effectsMoved(rt), false, 'the image drawn is the one the camera shows')
  const seen = dispatched().length
  const moving = image()
  assert.ok(
    moving && 'color' in moving && moving.color !== lit,
    'the lit image blurred, none of the temporal pass’s',
  )
  assert.deepEqual(dispatched().slice(seen, seen + 2), ['surfaceVelocity', 'flattenMotion'])
  const { invViewProj, prevViewProj } = TAA_VIEW.at
  const told = [view()[prevViewProj + 12], view()[invViewProj + 12]]
  assert.deepEqual(told, [0, -0.25], 'the last image’s view is the one the motion is told against')
  assert.equal(effectsMoved(rt), true, 'a quiet view is drawn once more, its motion nil')
  assert.equal(image(), undefined, 'which has no motion to blur')
  assert.equal(effectsMoved(rt), false)
})

test('the velocity stage is made for a blur that draws, and its target given back when none does', async () => {
  const chain = new EffectChain().add(effect.bloom())
  const { rt, cam, image, dispatched } = untemporal(chain)
  image()
  assert.deepEqual([rt.gpu.velocity, dispatched().includes('surfaceVelocity')], [undefined, false])
  chain.add(effect.motionBlur())
  image()
  await rt.gpu.effects!.settled()
  cam.viewProjection[12] = 0.25
  assert.ok(image() && rt.gpu.velocity!.bytes > 0, 'asked by the blur alone')
  Object.assign(rt.context, { motionBlurQuality: 'off' })
  assert.equal(effectsMoved(rt), true, 'a setting changed breaks the hold')
  assert.equal(image(), undefined, 'the quality off blurs nothing')
  assert.deepEqual([rt.gpu.velocity!.bytes, rt.gpu.effects?.bytes], [0, 0], 'and holds nothing')
  assert.equal(effectsMoved(rt), false, 'drawn with it')
})

test('a depth of field draws on the lit image with no motion measured, and its quality off draws none', async () => {
  const dof = effect.depthOfField({ depthBlurRadius: 1000 }) // a depth blur alone, wide enough for 8 pixels
  const { rt, lit, image } = untemporal(new EffectChain().add(dof))
  assert.equal(image('lit'), undefined, 'drawn unblurred while its programs compile')
  await rt.gpu.effects!.settled()
  image('lit') // asks for its pipelines
  await new Promise((resolve) => setTimeout(resolve))
  const sharp = image('lit')
  assert.ok(sharp && sharp !== lit, 'the lit image blurred')
  assert.equal(rt.gpu.velocity, undefined, 'no motion measured for it')
  assert.equal(resolveFrame.temporal.slot, rt.run.frame % 8, 'its noise turns with the frame')
  Object.assign(rt.context, { depthOfFieldQuality: 'off' })
  assert.equal(effectsMoved(rt), true, 'a setting changed breaks the hold')
  assert.equal(image('lit'), undefined, 'the quality off draws nothing')
  assert.equal(rt.gpu.effects?.bytes, 0, 'and holds nothing')
})
