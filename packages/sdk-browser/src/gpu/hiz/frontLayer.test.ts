import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuHiz } from './factory.ts'
import { destroyRetired } from '../core/frameRetire.ts'
import { level0LayerBytes, pyramidHeldBytes } from './pyramid.ts'
import {
  HIZ_DEPTH_LAYERS,
  HIZ_FOLD_WGSL,
  HIZ_FRONT_LAYER,
  HIZ_OPAQUE_LAYER,
  hizTextureBytes,
} from './pyramidTexture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { pyramidBytes } from './oracle.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { HIZ_LEVELS_FRONT_WORD } from './levelsUniform.ts'

const LEVEL_0 = 'Trillion3D Hi-Z level 0'

test('an opaque scene’s level 0 is one layer: the front layer is made at the first ask, the opaque depth copied once', async () => {
  const { device, textures, textureCopies, destroyed } = fakeDevice()
  const hiz = await createGpuHiz(device, 16, 8, 4)
  assert.ok(hiz)
  const level0s = () => textures.filter((texture) => texture.label === LEVEL_0)
  const layers = (texture: GPUTexture) => texture.depthOrArrayLayers
  const opaque = hiz.level0
  assert.equal(layers(opaque), 1, 'no byte for transparents an opaque scene does not hold')
  assert.equal(hiz.holdsFront, false)
  const depth = hiz.depth()
  const encoder = device.createCommandEncoder()
  const front = hiz.front(encoder, true)
  assert.ok(front)
  assert.equal(level0s().length, 2)
  assert.equal(layers(hiz.level0), 2, 'the opaque depth and the front depth')
  assert.equal(hiz.holdsFront, true, 'the budget counts the layer it holds')
  assert.deepEqual(
    textureCopies.map(({ from, to, size }) => [from.texture, to.texture, size]),
    [[opaque, hiz.level0, [16, 8, 1]]],
    'the opaque depth this image drew carried into the new level 0',
  )
  assert.notEqual(hiz.depth(), depth, 'its readers bind the new level 0')
  assert.equal(destroyed.includes(opaque), false, 'commands of this image may still name it')
  destroyRetired(device)
  assert.ok(destroyed.includes(opaque), 'retired after the frame')
  assert.equal(hiz.front(encoder, true), front, 'asked again, nothing is made')
  assert.equal(textureCopies.length, 1)
  assert.equal(hiz.resize(device, 32, 32), true)
  assert.equal(layers(hiz.level0), 2, 'a pyramid made after holds it')
  hiz.dispose()
})

test('a scene whose transparents come and go keeps the front layer: its fold follows the frame word', async () => {
  const { device, textureCopies, writes, passDescriptors } = fakeDevice()
  const hiz = await createGpuHiz(device, 16, 8, 4)
  assert.ok(hiz)
  const encoder = device.createCommandEncoder()
  const front = hiz.front(encoder, true)
  assert.ok(front)
  const glass = hiz.level0,
    depth = hiz.depth()!,
    table = (depth.resources[2] as GPUBufferBinding).buffer
  const word = () => writes.filter((w) => w.buffer === table).at(-1)!.data[HIZ_LEVELS_FRONT_WORD]
  const clears = () =>
    passDescriptors.filter(
      (d) =>
        [...((d as GPURenderPassDescriptor | undefined)?.colorAttachments ?? [])][0]?.view ===
        front,
    ).length
  assert.equal(word(), 1, 'the readers fold the layer this image writes')
  assert.equal(hiz.front(encoder, false), undefined, 'no front layer this image writes')
  assert.equal(hiz.holdsFront, true, 'kept while the glass is away')
  assert.equal(word(), 0, 'the fold reads the opaque depth alone, never the last glass')
  assert.equal(hiz.level0, glass, 'level 0 kept: nothing made, copied or bound again')
  assert.equal(hiz.depth(), depth)
  assert.equal(textureCopies.length, 1, 'the opaque depth was carried once, at the first ask')
  assert.equal(hiz.front(encoder, false), undefined)
  assert.equal(clears(), 0)
  assert.equal(hiz.front(encoder, true), front, 'the glass back: the same layer')
  assert.equal(clears(), 1, 'the last glass cleared once before the fold writes again')
  assert.equal(word(), 1)
  assert.equal(hiz.resize(device, 32, 32), true)
  assert.equal(hiz.level0.depthOrArrayLayers, 2, 'a pyramid made after holds the layer')
  hiz.dispose()
})

test('a pyramid’s held bytes count one layer of level 0: the front layer is the transparents’', () => {
  assert.equal(level0LayerBytes(640, 400), 640 * 400 * 4)
  assert.equal(pyramidHeldBytes(640, 400), 640 * 400 * 4 + hizTextureBytes(pyramidBytes(640, 400)))
})

test('a fold of an image that wrote no front layer is its opaque depth: no texel past it is read', () => {
  const loads: number[] = []
  const { hizFold, hizFoldOver } = shaderRun<{
    hizFold: (depth: object, p: number[], front: boolean) => number
    hizFoldOver: (depth: object, p: number[], front: boolean) => boolean
  }>(HIZ_FOLD_WGSL, ['hizFold', 'hizFoldOver'], {
    // The front layer holds a nearer depth than the opaque: the last glass, or a texel past a level 0
    // of one layer.
    textureLoad: (_: object, __: number[], layer: number) => (
      loads.push(layer),
      [layer === HIZ_FRONT_LAYER ? 0.9 : 0.5]
    ),
  })
  const level0 = { layers: HIZ_DEPTH_LAYERS }
  assert.equal(hizFold(level0, [0, 0], false), 0.5)
  assert.equal(hizFoldOver(level0, [0, 0], false), false)
  assert.deepEqual(loads, [HIZ_OPAQUE_LAYER])
  assert.equal(hizFold(level0, [0, 0], true), 0.9, 'written, the nearer')
  assert.equal(hizFoldOver(level0, [0, 0], true), true)
})
