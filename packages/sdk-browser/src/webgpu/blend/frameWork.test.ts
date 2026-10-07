// What a frame asks of the CPU for the transparent order: the frustum verdict,
// and the keys and order of the own entries only. A pass of one class — the ordinary scene — has
// none: no key, no sort, no per-item word sent; the GPU orders it.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { createBlendExpand } from './expand.ts'
import { encodeBlendExpansion } from './resources.ts'
import { EXPAND_PASSES, planWords, scratchWords } from './planLayout.ts'
import { orderStepCount } from './orderSteps.ts'
import { ORDER_UNI } from './orderWgsl.ts'
import type { BlendGpuItem } from './state.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const ITEMS = 2000

/** Paged single-sided items of one blend mode, each counting the reads of its world matrix: the
 *  key of an item reads it, the frustum verdict does not. */
function counted() {
  const reads = { matrix: 0 }
  const items = Array.from({ length: ITEMS }, (_, i) => {
    const matrix = new G.Matrix4().makeTranslation(i % 50, 0, Math.floor(i / 50))
    const item = {
      surface: surfaceOf(G.basicSurface({ transparent: true })),
      count: 0,
      paged: true,
      bounds: new Float64Array([i % 50, 0, i / 50, (i % 50) + 1, 1, i / 50 + 1]),
    } as unknown as BlendGpuItem
    Object.defineProperty(item, 'matrix', {
      get: () => (reads.matrix++, matrix),
    })
    return item
  })
  return { items, reads }
}

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
  const output = (label: string) =>
    device.createBuffer({ label, size: 16, usage: GPUBufferUsage.STORAGE })
  const entries = blendState.maxPlanEntries
  blendState.expandedBuffer = output('expanded')
  blendState.argsBuffer = output('args')
  blendState.expand = await createBlendExpand(
    device,
    {
      items: ITEMS,
      entries,
      planWords: planWords(entries),
      scratchWords: scratchWords(entries),
      stride: blendState.uniformStride,
    },
    { counts: undefined, clusters: undefined },
    { expanded: blendState.expandedBuffer, args: blendState.argsBuffer },
  )
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

test('a device aligning uniform offsets at 512 lays every step and pass 512 bytes apart', async () => {
  const { items } = counted()
  // Half the items transmissive: both passes are ordered and expanded.
  items.forEach((item, i) => (item.transmissive = i % 2 === 1))
  const { device, buffers, writes } = fakeDevice({
    limits: { minUniformBufferOffsetAlignment: 512 },
  })
  const blendState = blendSceneOf(items, device.limits)
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  const entries = blendState.maxPlanEntries,
    stride = blendState.uniformStride
  assert.equal(stride, 512)
  const output = (label: string) =>
    device.createBuffer({ label, size: 16, usage: GPUBufferUsage.STORAGE })
  blendState.expandedBuffer = output('expanded')
  blendState.argsBuffer = output('args')
  blendState.expand = await createBlendExpand(
    device,
    {
      items: ITEMS,
      entries,
      planWords: planWords(entries),
      scratchWords: scratchWords(entries),
      stride,
    },
    { counts: undefined, clusters: undefined },
    { expanded: blendState.expandedBuffer, args: blendState.argsBuffer },
  )
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
