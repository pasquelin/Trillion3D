// An image whose only transparent pass was the water's carries its front depth over the rectangle
// the GPU wrote (`frontFromWater`): the scatter dispatched from the GPU's workgroups, its rectangle
// copied on the GPU — the CPU never names it. A blend pass in the image writes the whole target,
// and the scatter goes back to the CPU's rectangle.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { commandArgs } from '../../../../tests/kit/gpu/fakeRenderPass.ts'
import { createFrontDepth } from './frontDepth.ts'
import { encodeFrontDepth } from './frontCarry.ts'
import { frontAttachment, frontFromWater } from './frontAttachment.ts'
import { VERDICT } from '../webgpu/blend/verdictLayout.ts'

/** A view's front depth with its carried buffers, and stand-ins for its stages. */
function carriedFront() {
  const fake = fakeDevice()
  const front = createFrontDepth(fake.device, 8, 8, true)
  const verdict = fake.device.createBuffer({
    size: 256,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.INDIRECT |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  })
  const pipeline = (entryPoint: string) => ({ entryPoint }) as unknown as GPUComputePipeline
  const stages = {
    frontLayout: {},
    frontBoxLayout: {},
    frontPipeline: pipeline('frontScatter'),
    frontFoldPipeline: pipeline('frontFold'),
    frontBoxPipeline: pipeline('frontBox'),
  } as never
  const reflection = {
    device: fake.device,
    uniform: fake.device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM }),
    front,
    radiance: { held: { size: [8, 8] } },
  } as never
  /** The Hi-Z level 0's front layer the carry folds into (`GpuHiz.front`). */
  const layer = () =>
    fake.device
      .createTexture({
        size: [8, 8, 2],
        format: 'r32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
      })
      .createView({ dimension: '2d', baseArrayLayer: 1, arrayLayerCount: 1 })
  const folded = layer()
  /** The next image's carry into `into`: its scatter pass's dispatches. */
  const carry = (into = folded) => {
    const encoder = fake.device.createCommandEncoder()
    encodeFrontDepth(encoder, reflection, stages, into)
    return fake.computePasses.at(-1)!.commands
  }
  return { fake, front, verdict, carry, layer }
}

test('a water-only image: the GPU rectangle and workgroups carry its front depth', () => {
  const { fake, front, verdict, carry } = carriedFront()
  frontAttachment(front, true)
  frontFromWater(fake.device.createCommandEncoder(), front, verdict)
  const carried = front.carried!
  assert.deepEqual(
    fake.copies.map(({ from, fromOffset, to }) => [from, fromOffset, to]),
    [
      [verdict, VERDICT.rect * 4, carried.waterRect],
      [verdict, VERDICT.frontArgs * 4, carried.waterArgs],
    ],
  )
  const writes = fake.writes.length
  const commands = carry()
  assert.deepEqual(commandArgs(commands, 'dispatchWorkgroupsIndirect')[0], [carried.waterArgs, 0])
  assert.equal(fake.writes.length, writes, 'no rectangle written by the CPU')
})

test('a blend pass in the image: the whole target, the CPU rectangle, nothing copied', () => {
  const { fake, front, verdict, carry } = carriedFront()
  frontAttachment(front)
  frontAttachment(front, true)
  frontFromWater(fake.device.createCommandEncoder(), front, verdict)
  assert.deepEqual(fake.copies, [], 'the water is not the only writer')
  const commands = carry()
  assert.deepEqual(commandArgs(commands, 'dispatchWorkgroups')[0], [1, 1])
})

test('a front layer the carry never folded into is cleared once, before any fold', () => {
  const { fake, front, carry, layer } = carriedFront()
  const clears = () =>
    fake.passDescriptors.filter((pass) =>
      [...((pass as GPURenderPassDescriptor | undefined)?.colorAttachments ?? [])].some(
        (color) => color?.loadOp === 'clear',
      ),
    ).length
  frontAttachment(front)
  carry()
  assert.equal(clears(), 1, 'the first carry clears the layer')
  frontAttachment(front)
  carry()
  assert.equal(clears(), 1, 'the same layer is not cleared again')
  frontAttachment(front)
  carry(layer())
  assert.equal(clears(), 2, "another pyramid's layer is cleared")
})
