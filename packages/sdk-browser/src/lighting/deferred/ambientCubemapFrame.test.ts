// The ambient cubemap of an image (`ambientCubemapFrame.ts`): on only for a cube whose colour is not black, its texture the cube's mip
// chain in half floats written over images until whole, its colour the tint times the intensity, kept while the data is the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { AMBIENT_CUBEMAP_RULES } from '../../../../sdk-core/src/contracts/ambientCubemapOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  ambientCubemapOn,
  ambientCubemapPending,
  ambientCubemapResources,
  releaseAmbientCubemap,
} from './ambientCubemapFrame.ts'

const SIZE = 16
const cube = (value = 0.5) => ({
  size: SIZE,
  texels: new Float32Array(6 * SIZE * SIZE * 3).fill(value),
})
const LABEL = 'Trillion3D ambient cubemap'

/** A runtime of the parts the frame reads: the context's cube and settings, the device. */
function runtime(settings: Parameters<typeof resolveSettings>[1], data?: ReturnType<typeof cube>) {
  const gpu = fakeDevice(BACKEND)
  const rt = {
    context: { ...resolveSettings(AMBIENT_CUBEMAP_RULES, settings), ambientCubemap: data },
    lights: {},
    gpu: { device: gpu.device },
  } as unknown as WebgpuPagesRuntime
  return { rt, gpu }
}

/** The images it takes for the chain to be whole. */
function untilWhole(rt: WebgpuPagesRuntime) {
  for (let image = 1; image < 10_000; image++) {
    const bound = ambientCubemapResources(rt, true)
    if (bound) return { bound, images: image }
  }
  throw new Error('the chain never became whole')
}

test('the image has the light only for a cube whose colour is not black', () => {
  assert.equal(ambientCubemapOn(runtime({}).rt), false)
  assert.equal(ambientCubemapOn(runtime({}, cube()).rt), true)
  assert.equal(ambientCubemapOn(runtime({ ambientCubemapIntensity: 0 }, cube()).rt), false)
  const black = { ambientCubemapTintRed: 0, ambientCubemapTintGreen: 0, ambientCubemapTintBlue: 0 }
  assert.equal(ambientCubemapOn(runtime(black, cube()).rt), false)
  const { rt, gpu } = runtime({ ambientCubemapIntensity: 0 }, cube())
  assert.equal(ambientCubemapResources(rt, true), undefined)
  assert.equal(gpu.textures.length, 0)
})

test('the cube is a texture of its mip chain in half floats, every texel of every face written, and kept while the data is the same', () => {
  const data = cube()
  const { rt, gpu } = runtime({}, data)
  assert.equal(ambientCubemapResources(rt, false), undefined)
  assert.equal(gpu.textures.length, 0, 'a view that is not lit makes nothing')
  const { bound } = untilWhole(rt)
  assert.ok(bound.view)
  const made = gpu.textures.filter((texture) => texture.label === LABEL)
  assert.equal(made.length, 1)
  assert.deepEqual([made[0].width, made[0].height, made[0].depthOrArrayLayers], [SIZE, SIZE, 6])
  assert.equal(made[0].format, 'rgba16float')
  assert.equal(made[0].mipLevelCount, 5)
  // Each texel of each face of each mip is written once.
  const texels = new Map<string, number>()
  for (const { destination, size } of gpu.textureWrites) {
    const { width, height } = size as { width: number; height: number }
    const key = `${destination.mipLevel}/${(destination.origin as number[])[2]}`
    texels.set(key, (texels.get(key) ?? 0) + width * height)
  }
  assert.equal(texels.size, 30)
  for (const [key, count] of texels)
    assert.equal(count, (SIZE >> Number(key.split('/')[0])) ** 2, key)
  const written = gpu.textureWrites.length
  assert.equal(ambientCubemapPending(rt), false)
  assert.ok(ambientCubemapResources(rt, true))
  assert.equal(gpu.textureWrites.length, written, 'nothing is written again')
  assert.equal(gpu.textures.filter((texture) => texture.label === LABEL).length, 1)
})

test('the colour written is the tint times the intensity', () => {
  const { rt, gpu } = runtime(
    {
      ambientCubemapTintRed: 0.5,
      ambientCubemapTintBlue: 2,
      ambientCubemapIntensity: 3,
    },
    cube(),
  )
  untilWhole(rt)
  const colour = gpu.writes.at(-1)!
  assert.deepEqual([...colour.data], [1.5, 3, 6, 0])
})

test('a cube taken away leaves the image without the light, and the session end releases the state', () => {
  const { rt } = runtime({}, cube())
  untilWhole(rt)
  ;(rt.context as { ambientCubemap?: unknown }).ambientCubemap = undefined
  assert.equal(ambientCubemapOn(rt), false)
  assert.equal(ambientCubemapResources(rt, true), undefined)
  assert.equal(ambientCubemapPending(rt), false)
  releaseAmbientCubemap(rt)
  assert.equal(rt.lights.ambientCubemap, undefined)
})
