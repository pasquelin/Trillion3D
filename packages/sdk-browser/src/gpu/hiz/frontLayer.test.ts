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

const LEVEL_0 = 'Trillion3D Hi-Z level 0'

test('an opaque scene’s level 0 is one layer: the front layer is made at the first ask, the opaque depth copied once', async () => {
  const { device, textures, textureCopies, destroyed } = fakeDevice()
  const hiz = await createGpuHiz(device, 16, 8, 4)
  assert.ok(hiz)
  const level0s = () => textures.filter((texture) => texture.label === LEVEL_0)
  const layers = (texture: GPUTexture) => texture.depthOrArrayLayers
  const opaque = hiz.level0
  assert.equal(layers(opaque), 1, 'no byte for transparents an opaque scene does not hold')
  const depth = hiz.depth()
  const encoder = device.createCommandEncoder()
  const front = hiz.front(encoder)
  assert.ok(front)
  assert.equal(level0s().length, 2)
  assert.equal(layers(hiz.level0), 2, 'the opaque depth and the front depth')
  assert.deepEqual(
    textureCopies.map(({ from, to, size }) => [from.texture, to.texture, size]),
    [[opaque, hiz.level0, [16, 8, 1]]],
    'the opaque depth this image drew carried into the new level 0',
  )
  assert.notEqual(hiz.depth(), depth, 'its readers bind the new level 0')
  assert.equal(destroyed.includes(opaque), false, 'commands of this image may still name it')
  destroyRetired(device)
  assert.ok(destroyed.includes(opaque), 'retired after the frame')
  assert.equal(hiz.front(encoder), front, 'asked again, nothing is made')
  assert.equal(textureCopies.length, 1)
  assert.equal(hiz.resize(device, 32, 32), true)
  assert.equal(layers(hiz.level0), 2, 'a pyramid made after holds it')
  hiz.dispose()
})

test('a pyramid’s held bytes count one layer of level 0: the front layer is the transparents’', () => {
  assert.equal(level0LayerBytes(640, 400), 640 * 400 * 4)
  assert.equal(pyramidHeldBytes(640, 400), 640 * 400 * 4 + hizTextureBytes(pyramidBytes(640, 400)))
})

test('the fold of a level 0 of one layer is its opaque depth: no texel past it is read', () => {
  const loads: number[] = []
  const { hizFold, hizFoldOver } = shaderRun<{
    hizFold: (depth: object, p: number[]) => number
    hizFoldOver: (depth: object, p: number[]) => boolean
  }>(HIZ_FOLD_WGSL, ['hizFold', 'hizFoldOver'], {
    // Past the texture's layers, a load answers any texel of it: a nearer depth than the opaque.
    textureLoad: (_: object, __: number[], layer: number) => (
      loads.push(layer),
      [layer === HIZ_FRONT_LAYER ? 0.9 : 0.5]
    ),
  })
  assert.equal(hizFold({ layers: 1 }, [0, 0]), 0.5)
  assert.equal(hizFoldOver({ layers: 1 }, [0, 0]), false)
  assert.deepEqual(loads, [HIZ_OPAQUE_LAYER])
  assert.equal(hizFold({ layers: HIZ_DEPTH_LAYERS }, [0, 0]), 0.9, 'with it, the nearer')
  assert.equal(hizFoldOver({ layers: HIZ_DEPTH_LAYERS }, [0, 0]), true)
})
