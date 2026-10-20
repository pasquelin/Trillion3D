// What the effect chain on the WebGPU path hands on: a diagnostic view, a capture and an empty
// chain show the engine's image without it; a composition gets the last bloom's blend; an outline
// draws over the display only with objects.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../../sdk-core/src/world/effect/index.ts'
import { encodeEffects, encodeOverlayEffects } from './encodeEffects.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { drawing, encoder, input } from './encodeEffects.fixture.ts'

test('a diagnostic view, a capture and an empty chain make nothing and hand the input on', () => {
  const { device, textures } = fakeDevice()
  const chain = new EffectChain()
  const rt = drawing(chain)
  assert.equal(encodeEffects(rt, device, encoder, input), input)
  assert.equal(rt.gpu.effects, undefined, 'an empty chain has no targets and no programs')
  chain.add(effect.bloom())
  Object.assign(rt.run, { diagnostic: 'normals' })
  assert.equal(encodeEffects(rt, device, encoder, input), input)
  Object.assign(rt.run, { diagnostic: 'beauty' })
  rt.capture.capturing = true
  assert.equal(encodeEffects(rt, device, encoder, input), input)
  assert.deepEqual([rt.gpu.effects, textures.length], [undefined, 0])
  assert.equal(rt.gpu.effectsRevision, chain.revision, 'the revision drawn is kept all the same')
})

test('a composition that blends the last bloom in gets its blend, and reads the image it read', async () => {
  const { device } = fakeDevice()
  const rt = drawing(new EffectChain().add(effect.bloom()))
  let composes = false
  const asked: unknown[] = []
  const deferred = { composesBloom: (fail: unknown) => (asked.push(fail), composes) }
  Object.assign(rt.gpu, { deferred })
  encodeEffects(rt, device, encoder, input)
  await rt.gpu.effects!.settled()
  assert.equal(encodeEffects(rt, device, encoder, input)?.bloom, undefined, 'still compiling')
  composes = true
  const composed = encodeEffects(rt, device, encoder, input)
  assert.deepEqual([composed?.color, composed?.share], [input.color, input.share])
  assert.ok(composed?.bloom?.group, 'the level group and slot the composition binds')
  assert.ok(asked.length > 0)
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
