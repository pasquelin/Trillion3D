// What the effect chain on the WebGPU path hands on: a view the finishing leaves as it is — a
// diagnostic view, a capture, one lit by no declared lamp — and an empty chain show the engine's
// image without it; a composition gets the last bloom's glow; an outline draws over the display
// only with objects.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { encodeEffects, encodeOverlayEffects } from './encodeEffects.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { computePasses, drawing, encoder, framed, input, passes } from './encodeEffects.fixture.ts'
import { askLocalPrograms, localProgramsReady } from '../../post/finish/local.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { PostFrame } from '../../post/finish/finish.ts'

test('a view left as it is and an empty chain make nothing and hand the input on', () => {
  const { device, textures } = fakeDevice()
  const chain = new EffectChain()
  const rt = drawing(chain)
  assert.equal(encodeEffects(rt, device, encoder, input, {} as PostFrame), input)
  assert.equal(rt.gpu.effects, undefined, 'an empty chain has no targets and no programs')
  chain.add(effect.bloom())
  Object.assign(rt.run, { diagnostic: 'normals' })
  assert.equal(framed(rt, device), undefined, 'a diagnostic view is not finished')
  assert.equal(encodeEffects(rt, device, encoder, input, undefined), input)
  Object.assign(rt.run, { diagnostic: 'beauty' })
  rt.capture.capturing = true
  assert.equal(framed(rt, device), undefined, 'nor a capture')
  assert.equal(encodeEffects(rt, device, encoder, input, undefined), input)
  rt.capture.capturing = false
  Object.assign(rt.lights.store, { unlit: true })
  assert.equal(framed(rt, device), undefined, 'nor a view that shows the albedo')
  assert.equal(encodeEffects(rt, device, encoder, input, undefined), input)
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
  encodeEffects(rt, device, encoder, input, framed(rt, device))
  await rt.gpu.effects!.settled()
  const compiling = encodeEffects(rt, device, encoder, input, framed(rt, device))
  assert.equal(compiling?.glow, undefined, 'still compiling')
  composes = true
  const composed = encodeEffects(rt, device, encoder, input, framed(rt, device))
  assert.deepEqual([composed?.color, composed?.share], [input.color, input.share])
  assert.ok(composed?.glow, 'the glow the composition adds')
  assert.ok(asked.length > 0)
})

test('the local exposure draws its layers before the chain, and the bloom sets up with them', async () => {
  const { device } = fakeDevice()
  const rt = drawing(new EffectChain().add(effect.bloom()))
  askLocalPrograms(device)
  while (!localProgramsReady(device)) await new Promise((resolve) => setTimeout(resolve))
  encodeEffects(rt, device, encoder, input, framed(rt, device))
  await rt.gpu.effects!.settled()
  passes.length = computePasses.length = 0
  const post = framed(rt, device)
  assert.equal(post?.local, true, 'the settings ask for it, its programs are compiled')
  // The grid, one workgroup a tile of the half-size image; then the scene's levels the blur
  // reads — the half-size image and four more —, the log luminance and its two blur passes.
  assert.equal(computePasses.length, 1)
  assert.equal(passes.length, 5 + 1 + 2)
  encodeEffects(rt, device, encoder, input, post)
  // The bloom's setup, which applies the layers, the five levels under it, the six blurs.
  assert.equal(passes.length, 5 + 1 + 2 + 1 + 5 + 12)
  const setup = passes[5 + 1 + 2]
  const groups = commandArgs(setup.commands, 'setBindGroup')
  assert.equal(groups[1][1], post?.layers, 'the finishing’s group, with the layers, at 1')
  assert.notEqual(post?.layers, post?.bare)
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
