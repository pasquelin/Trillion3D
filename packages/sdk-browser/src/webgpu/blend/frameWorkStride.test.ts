// A device aligning uniform offsets at 512 bytes: the blend's steps and passes lie 512 bytes apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { counted, expandable } from './frameWork.fixture.ts'
import { encodeBlendExpansion } from './resources.ts'
import { EXPAND_PASSES } from './planLayout.ts'
import { orderStepCount } from './orderSteps.ts'
import { ORDER_UNI } from './orderWgsl.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('a device aligning uniform offsets at 512 lays every step and pass 512 bytes apart', async () => {
  const { items } = counted()
  // Half the items transmissive: both passes are ordered and expanded.
  items.forEach((item, i) => (item.transmissive = i % 2 === 1))
  const { device, buffers, writes } = fakeDevice({
    limits: { minUniformBufferOffsetAlignment: 512 },
  })
  const blendState = blendSceneOf(items, device.limits)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  assert.equal(blendState.uniformStride, 512)
  const entries = await expandable(device, blendState)
  const offsets: number[] = []
  const pass = new Proxy(
    {},
    {
      get: (_, name) =>
        name === 'setBindGroup'
          ? (_index: number, _group: unknown, dynamic: readonly number[]) =>
              void offsets.push(dynamic[0])
          : () => undefined,
    },
  )
  const encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder
  orderBlendPasses(blendState, [0, 5, 0])
  encodeBlendExpansion({ blendState } as unknown as WebgpuPagesRuntime, encoder)

  const steps = blendState.orderSteps
  assert.ok(steps[0].length && steps[1].length, 'both passes ordered')
  const size = (label: string) => buffers.find((b) => b.label === label)!.size
  assert.equal(size('Trillion3D blend expand uniforms'), EXPAND_PASSES * 512)
  const stepCount = EXPAND_PASSES * orderStepCount(entries)
  assert.equal(size('Trillion3D blend order steps'), stepCount * 512)
  assert.equal(blendState.orderStepWords.length, stepCount * 128)
  // Each step's words open its 512-byte slot: the pass's entry count at its first word.
  steps.forEach((passSteps, p) => {
    for (const step of passSteps)
      assert.equal(
        blendState.orderStepWords[step.uniform * 128 + ORDER_UNI.entryCount],
        blendState.seeds[p].length,
      )
  })
  // The expansion's uniform of pass p written at p × 512.
  const uniforms = buffers.find((b) => b.label === 'Trillion3D blend expand uniforms')
  const uniformWrites = writes
    .filter((w) => w.buffer === (uniforms as unknown as GPUBuffer))
    .map((w) => w.offset)
  assert.deepEqual(uniformWrites, [0, 512])
  // Each pass: its order's steps at 512 bytes a step, then its expansion at 512 bytes a pass.
  const expected = steps.flatMap((passSteps, p) => [
    ...passSteps.map((step) => step.uniform * 512),
    p * 512,
  ])
  assert.deepEqual(offsets, expected)
})
