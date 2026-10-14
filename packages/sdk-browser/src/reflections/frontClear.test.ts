// The Hi-Z's front layer has one owner, the front depth (`encodeFrontDepth`): an image that writes no
// front layer leaves the last glass in it, and the image that writes it again clears it once before
// its fold — never twice, even when the reflection is remade on that image.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuHiz } from '../gpu/hiz/factory.ts'
import { createFrontDepth } from './frontDepth.ts'
import { encodeDepthPyramid } from './frame.ts'

test('the last glass is cleared once by the front depth when the glass comes back', async () => {
  const fake = fakeDevice(),
    { device } = fake
  const hiz = await createGpuHiz(device, 8, 8, 4)
  assert.ok(hiz)
  const pipeline = (entryPoint: string) => ({ entryPoint }) as unknown as GPUComputePipeline
  const reflection = (blends: boolean) => ({
    device,
    uniform: device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM }),
    front: createFrontDepth(device, 8, 8, blends),
    radiance: { held: { size: [8, 8] }, levels: 1 },
    writeView() {},
  })
  const lightView = { uniform: device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM }) }
  const rt = {
    gpu: { reflection: reflection(true), deferred: lightView as typeof lightView | undefined },
    vis: {
      gpuHiz: hiz,
      reflectionPipelines: {
        frontLayout: {},
        frontBoxLayout: {},
        frontPipeline: pipeline('frontScatter'),
        frontFoldPipeline: pipeline('frontFold'),
        frontBoxPipeline: pipeline('frontBox'),
      },
    },
    run: { depthDrawn: false, clearColor: 0 },
    bounce: {},
    lights: { store: { environment: undefined } },
  }
  const image = () => encodeDepthPyramid(rt as never, device.createCommandEncoder())
  const clears = () =>
    fake.passDescriptors.filter((pass) =>
      [...((pass as GPURenderPassDescriptor | undefined)?.colorAttachments ?? [])].some(
        (color) => color?.loadOp === 'clear',
      ),
    ).length
  image()
  assert.equal(hiz.holdsFront, true)
  assert.equal(clears(), 1, 'the layer made, cleared once before the first fold')
  image()
  assert.equal(clears(), 1, 'the same layer, folded into again: no clear')
  rt.gpu.deferred = undefined
  image()
  assert.equal(clears(), 1, 'an image that writes no front layer clears nothing')
  rt.gpu.deferred = lightView
  image()
  assert.equal(clears(), 2, 'the glass back: the last glass cleared before the fold writes again')
  rt.gpu.reflection = reflection(false)
  image()
  rt.gpu.reflection = reflection(true)
  image()
  assert.equal(clears(), 3, 'the glass back with a reflection remade: one clear, not two')
  hiz.dispose()
})
