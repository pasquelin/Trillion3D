// What a frame asks of the CPU for the transparent order: the frustum verdict,
// and the keys and order of the own entries only. A pass of one class — the ordinary scene — has
// none: no key, no sort, no per-item word sent; the GPU orders it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { counted, expandable } from './frameWork.fixture.ts'
import { encodeBlendExpansion } from './resources.ts'
import { ORDER_UNI_WORDS } from './orderWgsl.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { fakeDevice, replayWrites, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('a frame keys and sorts no item of the main class on the CPU', () => {
  const { items, reads } = counted()
  const blendState = blendSceneOf(items)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  for (const eye of [
    [0, 5, 0],
    [25, 5, 20],
    [-3, 2, 60],
  ]) {
    reads.matrix = 0
    orderBlendPasses(blendState, eye)
    assert.equal(reads.matrix, 0, `eye ${eye}: no item key computed on the CPU`)
  }
})

test('a steady frame sends the GPU the eye alone: no order, no run, no word per item', async () => {
  const { items } = counted()
  const blendState = blendSceneOf(items)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  const { device, writes } = fakeDevice()
  await expandable(device, blendState)
  assert.ok(blendState.expand, 'the kernels are made')
  const dispatches: number[] = []
  const encoder = {
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups: (groups: number) => void dispatches.push(groups),
      end() {},
    }),
  } as unknown as GPUCommandEncoder
  const rt = { blendState } as unknown as WebgpuPagesRuntime
  orderBlendPasses(blendState, [0, 5, 0])
  encodeBlendExpansion(rt, encoder)
  for (const eye of [
    [25, 5, 20],
    [-3, 2, 60],
  ]) {
    writes.length = 0
    dispatches.length = 0
    orderBlendPasses(blendState, eye)
    encodeBlendExpansion(rt, encoder)
    const bytes = writes.reduce((sum, write) => sum + written(write).byteLength, 0)
    assert.equal(bytes, 32, `eye ${eye}: the eye, four doubles, and nothing else`)
    // The order's dispatches, fixed by the plan, then the expansion's four: the CPU asks no count.
    assert.equal(dispatches.length, blendState.orderSteps[0].length + 4)
  }
})

test('a plan sends its order steps in one write at 256 bytes, as the whole steps went, and no more', async () => {
  const { items } = counted()
  items.forEach((item, i) => (item.transmissive = i % 2 === 1))
  const { device, buffers, writes } = fakeDevice()
  const blendState = blendSceneOf(items, device.limits)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  await expandable(device, blendState)
  const encoder = {
    beginComputePass: () => new Proxy({}, { get: () => () => undefined }),
  } as unknown as GPUCommandEncoder
  const steps = buffers.find((b) => b.label === 'Trillion3D blend order steps')!
  const ofSteps = () => writes.filter((w) => w.buffer === (steps as unknown as GPUBuffer))
  writes.length = 0
  orderBlendPasses(blendState, [0, 5, 0])
  encodeBlendExpansion({ blendState } as unknown as WebgpuPagesRuntime, encoder)
  const sent = ofSteps()
  assert.equal(sent.length, 1, 'one write, the one the whole steps made')
  assert.ok(written(sent[0]).byteLength <= steps.size, 'never past the whole steps')
  // The buffer holds each step's words where its slot lies.
  const held = new Uint32Array(steps.size / 4)
  replayWrites(held.buffer, sent)
  for (const passSteps of blendState.orderSteps)
    for (const { uniform } of passSteps) {
      const at = uniform * 64
      assert.deepEqual(
        [...held.subarray(at, at + ORDER_UNI_WORDS)],
        [...blendState.orderStepWords.subarray(at, at + ORDER_UNI_WORDS)],
      )
    }
})
