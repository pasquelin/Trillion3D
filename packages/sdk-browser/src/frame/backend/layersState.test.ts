import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { BASE_SLOTS, HALF_SLOTS } from '../../visibility/bins/contract.ts'
import { createWebgpuVisState } from './state/vis.ts'
import { createWebgpuPagesLayout } from '../prepare/layout.ts'
import type { WebgpuPagesSetup } from '../prepare/setup.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { visSlotPipeline } from '../prepare/pipelineFor.ts'

// The coplanar-layer lot was reapplied in eleven WebGPU modules; each test below exercises the
// layer in a module that `../../geometry/clusters/infoWrite.test.ts` (the cluster record's bias) does not cover.
// The suite continues in `../../visibility/passes/drawLayers.test.ts` for the per-image draw modules.

const fakeSetup = (overrides: Partial<WebgpuPagesSetup> = {}) =>
  ({
    roots: [],
    bootstrap: [],
    slots: 4,
    cap: 4,
    census: { unitPages: 1 },
    ...overrides,
  }) as unknown as WebgpuPagesSetup

// state/vis.ts
test('createWebgpuVisState starts with drawLayerSlots at one', () => {
  const vis = createWebgpuVisState()
  assert.equal(vis.drawLayerSlots, 1)
})

// prepare/layout.ts
test('createWebgpuPagesLayout holds the clusters’ residency, and no CPU corner nor draw word', () => {
  const layout = createWebgpuPagesLayout(fakeSetup(), () => -1)
  // Per-slot counts no longer live here: the bins count them on the GPU, from the visible list.
  assert.equal('cornerPacked' in layout, false)
  assert.equal('drawItemWords' in layout, false)
  assert.equal(layout.clusters.candidateCount, 0)
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
  // The post pass's half draws with the main pass's pipelines (`GpuBins.encode`).
  assert.equal(visSlotPipeline(rt, BASE_SLOTS + HALF_SLOTS), back, 'its tested back cull')
})
