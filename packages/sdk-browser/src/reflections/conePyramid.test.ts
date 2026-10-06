import { REFLECTION_SOURCE_BYTES_PER_PIXEL } from './source.ts'
import { REFLECTION_SOURCE_VIEW_BYTES } from './sourceWgsl.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { createScreenReflection, REFLECTION_VIEW_BYTES } from './gpu.ts'
import { reflectionConeAllocation } from './conePyramid.ts'
import { reflectionBoundsPipelines } from './boundsPyramid.ts'
import {
  REFLECTION_BOUNDS_MIPS_PASS,
  REFLECTION_RADIANCE_MIPS_PASS,
  TEXTURE_MIPS_PASS,
} from '../texture/mipsPass.ts'

function extraBytes(width: number, height: number) {
  let texels = 0,
    reductions = 0
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.floor(width / 2))
    height = Math.max(1, Math.floor(height / 2))
    texels += width * height
    reductions++
  }
  return texels * 16 + reductions * 2 * 256
}

test('forward cone admission equals live descriptors at 4K and odd sizes without counting source twice', () => {
  for (const [width, height] of [
    [3840, 2160],
    [7, 5],
    [9, 1],
    [64, 32],
  ]) {
    const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } })
    const reflection = createScreenReflection(
      gpu.device,
      width,
      height,
      {} as GPUTextureView,
      true,
      false,
      true,
    )
    const bytes =
      gpu.textures.reduce((sum, texture) => sum + textureBytesOf(texture)!, 0) +
      gpu.buffers.reduce((sum, buffer) => sum + buffer.size, 0)
    assert.equal(
      bytes -
        width * height * (8 + REFLECTION_SOURCE_BYTES_PER_PIXEL) -
        REFLECTION_VIEW_BYTES -
        REFLECTION_SOURCE_VIEW_BYTES,
      extraBytes(width, height),
    )
    assert.equal(
      reflectionConeAllocation(width, height, gpu.device.limits).bytes,
      extraBytes(width, height),
    )
    assert.equal(reflection.history, undefined, 'no opaque receiver history for forward filtering')
    reflection.dispose()
    assert.equal(gpu.destroyed.length, gpu.textures.length + gpu.buffers.length)
    assert.equal(new Set(gpu.destroyed).size, gpu.destroyed.length)
  }
})

test('a failed depth chain releases its radiance chain and both owned textures', () => {
  const gpu = fakeDevice({
    limits: { minUniformBufferOffsetAlignment: 256 },
    refuse: (descriptor) =>
      descriptor.label === 'Trillion3D reflection depth bounds extents' ? 'throw' : undefined,
  })
  assert.throws(
    () => createScreenReflection(gpu.device, 64, 32, {} as GPUTextureView, true, false, true),
    /NO_MEMORY/,
  )
  assert.equal(gpu.destroyed.length, 3)
  assert.equal(new Set(gpu.destroyed).size, 3)
})

test("the cone's pyramids are named as the reflection's passes, never as a material texture's mips", async () => {
  const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } })
  const reflection = createScreenReflection(
    gpu.device,
    64,
    32,
    {} as GPUTextureView,
    true,
    false,
    true,
  )
  const labels: (string | undefined)[] = []
  const dispatched: number[][] = []
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    draw() {},
    dispatchWorkgroups: (x: number, y: number) => dispatched.push([x, y]),
    end() {},
  }
  const begin = ({ label }: GPURenderPassDescriptor) => (labels.push(label), pass)
  const encoder = { beginRenderPass: begin, beginComputePass: begin }
  const pipelines = await reflectionBoundsPipelines(gpu.device)
  reflection.pyramid!.encode(encoder as unknown as GPUCommandEncoder, pipelines)
  // 64×32 reduces six times to 1×1, a render pass a level; the bounds start at 32×16 and take six
  // levels, one compute pass: a dispatch of 8 × 8 threads over each level.
  assert.deepEqual(labels, [
    ...Array<string>(6).fill(REFLECTION_RADIANCE_MIPS_PASS),
    REFLECTION_BOUNDS_MIPS_PASS,
  ])
  assert.deepEqual(dispatched, [
    [4, 2],
    [2, 1],
    [1, 1],
    [1, 1],
    [1, 1],
    [1, 1],
  ])
  assert.ok(!labels.includes(TEXTURE_MIPS_PASS))
  reflection.dispose()
})
