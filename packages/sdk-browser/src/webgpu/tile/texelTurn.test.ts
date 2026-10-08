// A static picture's turn gives its ring and words back to the device, the next turn takes them:
// a burst of pictures at load allocates them once, never a ring made and destroyed a texture, and
// they are destroyed once no turn took them for the idle time. The texels are the GPU proof's
// (`tests/gpu/texture/texel-turn.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { READBACK_IDLE_MS } from '../../gpu/core/heldReadback.ts'
import { createTexelTurn, prepareTexelTurn } from './texelTurn.ts'
import { TEXEL_FLIP } from './texelTurnWgsl.ts'
import { tileCatalogue } from './catalogue.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { importHostTexture } from '../../host/textureImport.ts'
import { GraphTexture } from '../../host/graph/graph.fixture.ts'

test('static turns share the device’s ring and words, destroyed once idle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installGpuGlobals()
  const gpu = mockGpu()
  const turned = (width: number) => {
    const texture = gpu.device.createTexture({
      size: [width, 4],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING,
    })
    const turn = createTexelTurn(gpu.device, texture, width, 4)
    turn.upload(new Uint8Array(width * 16), TEXEL_FLIP)
    turn.release()
  }
  const before = gpu.buffers.length
  for (const width of [64, 64, 32]) turned(width)
  const made = gpu.buffers.slice(before) as unknown as { label: string; destroyed: boolean }[]
  assert.deepEqual(
    made.map(({ label }) => label),
    ['Trillion3D texel turn words', 'Trillion3D texel turn source'],
    'made by the first turn, taken by the next two',
  )
  assert.ok(
    made.every(({ destroyed }) => !destroyed),
    'held between the turns',
  )
  t.mock.timers.tick(READBACK_IDLE_MS)
  assert.ok(
    made.every(({ destroyed }) => destroyed),
    'destroyed once idle',
  )
})

// The turn program compiles off the thread before the first picture turns, and only for a scene
// with a host texture of raw texels to flip or premultiply.
test('the turn compiles ahead only for a host texture whose texels turn', async () => {
  installGpuGlobals()
  const compiled = async (flipY: boolean) => {
    const gpu = mockGpu()
    const host = new GraphTexture({ data: new Uint8Array(16), width: 2, height: 2 })
    host.flipY = flipY
    host.premultiplyAlpha = false
    const maps = [importHostTexture(host)]
    const textures = tileCatalogue(maps, () => undefined, undefined, poolEncoding(undefined))
    await prepareTexelTurn(gpu.device, textures)
    return gpu.computePipelines.filter(({ label }) => label === 'Trillion3D texel turn').length
  }
  assert.equal(await compiled(true), 1, 'raw texels to flip: compiled')
  assert.equal(await compiled(false), 0, 'texels as they are: nothing compiled')
})
