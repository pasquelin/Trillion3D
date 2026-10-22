// What the effect chain on the WebGPU path hands on: a view the finishing leaves as it is — a diagnostic
// view, a capture, one lit by no declared lamp — and an empty chain show the engine's image without it; a
// composition gets the last bloom's glow; an outline draws only with objects; the finishing's group carries the film.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import {
  effectsMoved,
  encodeEffects,
  encodeLitEffects,
  encodeOverlayEffects,
  encodeResolvedEffects,
} from './encodeEffects.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { computePasses, drawing, encoder, framed, input, passes } from './encodeEffects.fixture.ts'
import { resolveFrame } from './effectsFrame.ts'
import { askLocalPrograms, localProgramsReady } from '../../post/finish/local.ts'
import { finishedGroup, finishMoving } from '../../post/finish/frame.ts'
import { FINISH } from '../../post/finish/finishLayout.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { PostFrame } from '../../post/finish/finish.ts'
import { beginTaaFrame } from '../../post/taa/frame.ts'
import { encodeVelocity } from '../../post/taa/velocityFrame.ts'
import { TAA_VIEW } from '../../post/taa/bindingsWgsl.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { wordsOf } from '../../post/effects/webgpuEffects.fixture.ts'

test('a view left as it is and an empty chain make nothing and hand the input on', () => {
  const { device, textures } = fakeDevice()
  const chain = new EffectChain()
  const rt = drawing(chain)
  assert.equal(
    encodeEffects(rt, device, encoder, input, {} as PostFrame, rt.gpu.displaySize),
    input,
  )
  assert.equal(rt.gpu.effects, undefined, 'an empty chain has no targets and no programs')
  chain.add(effect.bloom())
  Object.assign(rt.run, { diagnostic: 'normals' })
  assert.equal(framed(rt, device), undefined, 'a diagnostic view is not finished')
  assert.equal(encodeEffects(rt, device, encoder, input, undefined, rt.gpu.displaySize), input)
  Object.assign(rt.run, { diagnostic: 'beauty' })
  rt.capture.capturing = true
  assert.equal(framed(rt, device), undefined, 'nor a capture')
  assert.equal(encodeEffects(rt, device, encoder, input, undefined, rt.gpu.displaySize), input)
  rt.capture.capturing = false
  Object.assign(rt.lights.store, { unlit: true })
  assert.equal(framed(rt, device), undefined, 'nor a view that shows the albedo')
  assert.equal(encodeEffects(rt, device, encoder, input, undefined, rt.gpu.displaySize), input)
  assert.deepEqual([rt.gpu.effects, textures.length], [undefined, 0])
  assert.equal(rt.gpu.effectsRevision, chain.revision, 'the revision drawn is kept all the same')
})

test('a composition that adds the last bloom gets its glow, and reads the image it read', async () => {
  const { device } = fakeDevice()
  const rt = drawing(new EffectChain().add(effect.bloom()))
  let composes = false
  const asked: unknown[] = []
  Object.assign(rt.gpu, {
    deferred: {
      ...rt.gpu.deferred,
      composesFinish: (sink: unknown) => (asked.push(sink), composes),
    },
  })
  encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  await rt.gpu.effects!.settled()
  const compiling = encodeEffects(
    rt,
    device,
    encoder,
    input,
    framed(rt, device),
    rt.gpu.displaySize,
  )
  assert.equal(compiling?.glow, undefined, 'still compiling')
  composes = true
  const composed = encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  assert.deepEqual([composed?.color, composed?.share], [input.color, input.share])
  assert.ok(composed?.glow, 'the glow the composition adds')
  assert.ok(asked.length > 0)
})

test('the local exposure draws its layers before the chain, and the bloom sets up with them', async () => {
  const { device } = fakeDevice()
  const rt = drawing(new EffectChain().add(effect.bloom()))
  askLocalPrograms(device)
  while (!localProgramsReady(device)) await new Promise((resolve) => setTimeout(resolve))
  encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  await rt.gpu.effects!.settled()
  passes.length = computePasses.length = 0
  const post = framed(rt, device)
  assert.equal(post?.local, true, 'the settings ask for it, its programs are compiled')
  // The grid, one workgroup a tile of the half-size image; then the scene's levels the blur
  // reads — the half-size image and four more —, the log luminance and its two blur passes.
  assert.equal(computePasses.length, 1)
  assert.equal(passes.length, 5 + 1 + 2)
  encodeEffects(rt, device, encoder, input, post, rt.gpu.displaySize)
  // The bloom's setup, which applies the layers, the five levels under it, the six blurs.
  assert.equal(passes.length, 5 + 1 + 2 + 1 + 5 + 12)
  const setup = passes[5 + 1 + 2]
  const groups = commandArgs(setup.commands, 'setBindGroup')
  assert.equal(groups[1][1], post?.layers, 'the finishing’s group, with the layers, at 1')
  assert.notEqual(post?.layers, post?.bare)
})

test('the finishing’s group is made for an image that shows a film effect, with the grain’s texture only where the grain is drawn', () => {
  const { device, buffers, textures } = fakeDevice()
  const rt = drawing(new EffectChain())
  let post = framed(rt, device)
  const uniform = () => {
    const { data } = buffers.find(({ label }) => label === 'Trillion3D display finish')!
    return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
  }
  const grains = () => textures.filter(({ label }) => label?.endsWith('finish grain')).length
  /** The group of the image the settings now written draw: the finishing reads them once, at its
   *  encode (`encodeFinish`). */
  const group = () => ((post = framed(rt, device)), finishedGroup(rt, post, undefined))
  const plain = finishedGroup(rt, post, undefined)
  assert.ok(plain && grains() === 0, 'the vignette and the dither are on: a group, and no grain')
  assert.equal(uniform()[FINISH.at.dither], Math.fround(1 / 255), 'the step of an 8-bit display')
  assert.deepEqual(
    [...uniform().subarray(FINISH.at.grainLevels, FINISH.at.grainLevels + 3)],
    [0, 0, 0],
  )
  rt.run.frame = 3
  finishedGroup(rt, post, undefined)
  assert.deepEqual(
    [uniform()[FINISH.at.dither + 1], uniform()[FINISH.at.dither + 2]],
    [halton(3, 2), halton(3, 3)].map(Math.fround),
    'the dither’s offset follows the image’s number',
  )
  rt.context.filmGrainIntensity = 0.5
  const grained = group()
  assert.notEqual(grained, plain, 'a group with the grain’s texture')
  assert.equal(grains(), 1)
  assert.equal(uniform()[FINISH.at.grainLevels], 0.5)
  assert.equal(group(), grained, 'kept while its images hold')
  assert.equal(grains(), 1, 'the texture is made once')
  rt.context.filmGrainIntensity = 0
  assert.equal(group(), plain, 'the grain off, the first group again')
  assert.equal(grains(), 1, 'its texture is kept for the grain to come back')
  assert.equal(finishMoving(rt), false, 'the settings are those the image was drawn with')
  for (const moved of [{ vignetteSoftness: 3 }, { gaussianSampleScale: 0.6 }]) {
    Object.assign(rt.context, moved) // a film setting, or one the local exposure’s blur follows
    assert.equal(finishMoving(rt), true, `${Object.keys(moved)}: the view is drawn again`)
    assert.equal((group(), finishMoving(rt)), false)
  }
  // Every film effect off — no dither (24 bits), no vignette (the quality that has none) — and no
  // local exposure or glow: the plain composition, no group.
  rt.context.quantizationDitheringBits = 32
  rt.context.tonemapperQuality = 1
  assert.equal(group(), undefined, 'nothing to finish')
  assert.equal(rt.gpu.finishPending, false)
  rt.context.sceneColorTintRed = 0.5
  assert.ok(group(), 'a tint is a film effect')
})

test('an outline draws over the display only with objects, in the beauty view, outside a capture', async () => {
  const { device, textures } = fakeDevice()
  const chain = new EffectChain()
  const outline = effect.outline()
  const rt = drawing(chain.add(outline))
  const node = new Object3D()
  const world = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
  const view = device.createTexture({ size: [8, 4], format: 'r32uint', usage: 0x14 }).createView()
  Object.assign(rt.gpu, { displayView: view })
  Object.assign(rt, { setup: { ...rt.setup, pixelRatio: () => 1 } })
  Object.assign(rt.vis, {
    visView: view,
    pageTable: device.createBuffer({ size: 64, usage: 0x80 }),
  })
  Object.assign(rt.layout, {
    selectionRoots: [{ pages: [{ drawSource: { node } }], world }],
    rootIndex: { revision: 0 },
  })
  const over = () => encodeOverlayEffects(rt, device, encoder, undefined)
  assert.equal(over(), 0, 'no object: idle')
  assert.deepEqual([textures.length - 1, rt.gpu.effects], [0, undefined], 'nothing made')
  outline.objects = [node]
  over()
  await rt.gpu.effects!.settled()
  assert.equal(over(), 2, 'the scan and the line')
  rt.capture.capturing = true
  assert.equal(over(), 0, 'a capture shows the image without it')
  rt.capture.capturing = false
  Object.assign(rt.run, { diagnostic: 'normals' })
  assert.equal(over(), 0, 'and a diagnostic view')
  Object.assign(rt.run, { diagnostic: 'beauty' })
  chain.remove(outline)
  assert.equal(over(), 0)
  assert.equal(rt.gpu.effects!.bytes, 0, 'a chain without it holds nothing for it')
})

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
  })
  const cam = {
    viewProjection: Float64Array.from(IDENTITY_MATRIX4),
    projection: Float64Array.from(IDENTITY_MATRIX4),
    eye: [0, 0, 0],
    perspective: 1,
    near: 0.1,
  } as unknown as EngineCamera
  /** One image: its entry, the velocity stage, then the passes on the resolved image — or, `lit`, on
   *  the lit image before the temporal pass; what they leave. */
  const image = (stage: 'resolved' | 'lit' = 'resolved') => {
    beginTaaFrame(rt, cam)
    rt.run.frame++
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
  assert.ok(dispatched().includes('surfaceVelocity'), 'the stage measured the image all the same')
  await rt.gpu.effects!.settled()
  const velocity = rt.gpu.velocity!
  const view = () => wordsOf(velocity.uniform)
  assert.equal(image(), undefined, 'a still image is left as it is: no streak, no pass')
  cam.viewProjection[12] = 0.25
  assert.equal(effectsMoved(rt), false, 'the image drawn is the one the camera shows')
  const seen = dispatched().length
  const moving = image()
  assert.ok(moving && moving.color !== lit, 'the lit image blurred, none of the temporal pass’s')
  assert.deepEqual(dispatched().slice(seen, seen + 2), ['surfaceVelocity', 'flattenMotion'])
  // The last image's view is the one the motion is told against.
  const { invViewProj, prevViewProj } = TAA_VIEW.at
  assert.deepEqual([view()[prevViewProj + 12], view()[invViewProj + 12]], [0, -0.25])
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
  rt.context.motionBlurQuality = 'off'
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
  rt.context.depthOfFieldQuality = 'off'
  assert.equal(effectsMoved(rt), true, 'a setting changed breaks the hold')
  assert.equal(image('lit'), undefined, 'the quality off draws nothing')
  assert.equal(rt.gpu.effects?.bytes, 0, 'and holds nothing')
})
