// A device aligning uniform offsets at 512 bytes: the blend's steps and passes lie 512 bytes apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { counted, expandable } from './frameWork.fixture.ts'
import { encodeBlendExpansion } from './expansionFrame.ts'
import { orderStepCount } from './orderSteps.ts'
import { ORDER_UNI } from './orderWgsl.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'

test('a device aligning uniform offsets at 512 lays every step and pass 512 bytes apart', async () => {
  const { items } = counted()
  // Half the items transmissive: they are ordered and expanded with the blends, in one pass.
  items.forEach((item, i) => (item.transmissive = i % 2 === 1))
  const fake = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 512 } }),
    { device, buffers, writes } = fake
  const blendState = blendSceneOf(items, device.limits)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  assert.equal(blendState.uniformStride, 512)
  const entries = await expandable(device, blendState)
  orderBlendPasses(blendState, [0, 5, 0])
  encodeBlendExpansion(
    { blendState, gpu: {}, run: {} } as unknown as WebgpuPagesRuntime,
    fake.device.createCommandEncoder(),
  )
  // The dynamic offset of each group the passes set: the verdict's group has none.
  const offsets = fake.computePasses
    .flatMap(({ commands }) => commandArgs(commands, 'setBindGroup'))
    .filter(([, , dynamic]) => dynamic !== undefined)
    .map(([, , dynamic]) => (dynamic as readonly number[])[0])

  const steps = blendState.orderSteps
  assert.ok(steps.length, 'the pass ordered')
  const size = (label: string) => buffers.find((b) => b.label === label)!.size
  assert.equal(size('Trillion3D blend expand uniforms'), 512)
  const stepCount = orderStepCount(entries)
  assert.equal(size('Trillion3D blend order steps'), stepCount * 512)
  assert.equal(blendState.orderStepWords.length, stepCount * 128)
  // Each step's words open its 512-byte slot: the pass's entry count at its first word.
  for (const step of steps)
    assert.equal(
      blendState.orderStepWords[step.uniform * 128 + ORDER_UNI.entryCount],
      blendState.seeds.length,
    )
  // The expansion's uniform written at 0.
  const uniforms = buffers.find((b) => b.label === 'Trillion3D blend expand uniforms')
  const uniformWrites = writes
    .filter((w) => w.buffer === (uniforms as unknown as GPUBuffer))
    .map((w) => w.offset)
  assert.deepEqual(uniformWrites, [0])
  // The order's steps at 512 bytes a step, then the expansion at 0.
  const expected = [...steps.map((step) => step.uniform * 512), 0]
  assert.deepEqual(offsets, expected)
})
