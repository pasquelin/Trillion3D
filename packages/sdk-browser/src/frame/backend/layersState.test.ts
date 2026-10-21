import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { BASE_SLOTS, DRAW_ITEM_U32, HALF_SLOTS } from '../../visibility/draw/contract.ts'
import { createWebgpuVisState } from './state/vis.ts'
import { createWebgpuPagesLayout } from '../prepare/layout.ts'
import type { WebgpuPagesSetup } from '../prepare/setup.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { visSlotPipeline } from '../prepare/pipelineFor.ts'

// The coplanar-layer lot was reapplied in eleven WebGPU modules; each test below exercises the
// layer in a module that `../../geometry/rows/page/pageRowDepthBias.test.ts` (`writePageRow` bias) does not cover.
// `../../geometry/rows/page/pageRowWriter.ts` stays covered there and has no test here. The suite continues in
// `../../visibility/passes/drawLayers.test.ts` for the per-image draw modules.

const fakeSetup = (overrides: Partial<WebgpuPagesSetup> = {}) =>
  ({
    roots: [],
    bootstrap: [],
    slots: 4,
    cap: 4,
    census: { unitPages: 1, clusterBytes: 12 },
    ...overrides,
  }) as unknown as WebgpuPagesSetup

// state/vis.ts
test('createWebgpuVisState starts with drawLayerSlots at one', () => {
  const vis = createWebgpuVisState()
  assert.equal(vis.drawLayerSlots, 1)
})

// prepare/layout.ts
test('createWebgpuPagesLayout holds the draw words per drawable row, and no CPU corner', () => {
  const layout = createWebgpuPagesLayout(fakeSetup(), undefined, () => -1)
  // Per-slot counts no longer live here: the draw compaction counts them on the GPU.
  assert.equal('cornerPacked' in layout, false)
  assert.equal(layout.drawItemWords.length, layout.drawSlots * DRAW_ITEM_U32)
})

// prepare/pipelineFor.ts
test('visSlotPipeline draws a coplanar-layer slot with its face mode’s pipeline', () => {
  const [back, none, front] = Array.from({ length: 3 }, (_, i) => ({
    id: i,
  })) as unknown as GPURenderPipeline[]
  const rt = {
    vis: {
      drawLayerSlots: 2,
      visPipelineBack: back,
      visPipelineNone: none,
      visPipelineFront: front,
    },
    layout: { selectionRoots: [{ world: new Matrix4() }] },
  } as unknown as WebgpuPagesCore
  assert.equal(visSlotPipeline(rt, BASE_SLOTS), back, 'layer 1, occluder, back cull')
  assert.equal(visSlotPipeline(rt, BASE_SLOTS + 1), none, 'layer 1, occluder, no cull')
  assert.equal(visSlotPipeline(rt, BASE_SLOTS + 2), front, 'layer 1, occluder, front cull')
  // The post pass's half draws with the main pass's pipelines (`GpuDraw.encodePost`).
  assert.equal(visSlotPipeline(rt, BASE_SLOTS + HALF_SLOTS), back, 'its tested back cull')
})
