// What a frame asks of the CPU for the transparent order (#831, GPU wave 1): the frustum verdict,
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
import { planWords, scratchWords } from './planLayout.ts'
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
    { items: ITEMS, entries, planWords: planWords(entries), scratchWords: scratchWords(entries) },
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
  encodeBlendExpansion(rt, device, encoder)
  for (const eye of [
    [25, 5, 20],
    [-3, 2, 60],
  ]) {
    writes.length = 0
    dispatches.length = 0
    orderBlendPasses(blendState, eye)
    encodeBlendExpansion(rt, device, encoder)
    const bytes = writes.reduce((sum, write) => sum + written(write).byteLength, 0)
    assert.equal(bytes, 32, `eye ${eye}: the eye, four doubles, and nothing else`)
    // The order's dispatches, fixed by the plan, then the expansion's four: the CPU asks no count.
    assert.equal(dispatches.length, blendState.orderSteps[0].length + 4)
  }
})
