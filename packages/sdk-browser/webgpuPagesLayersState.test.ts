import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { quadScene } from './webgpuPagesTestScenes.ts';
import { BASE_SLOTS, DRAW_ITEM_U32 } from './gpuDraw.ts';
import { CORNER_VALUES } from './gpuPartitionContract.ts';
import type { PageRec } from './pageSelection.ts';
import { createWebgpuVisState } from './webgpuPagesStateVis.ts';
import { createWebgpuPagesLayout } from './webgpuPagesLayout.ts';
import type { WebgpuPagesSetup } from './webgpuPagesSetup.ts';
import type { WebgpuPagesCore, WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { visSlotPipeline, visPipelineFor } from './webgpuPagesPipelineFor.ts';
import { dropVis } from './webgpuPagesDrops.ts';
import { createWebgpuRunState } from './webgpuPagesStateRun.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';

// The coplanar-layer lot was reapplied in eleven WebGPU modules; each test below exercises the
// layer in a module that `webgpuPages.19.test.ts` (`writePageRow` bias) does not cover.
// `webgpuPageRow.ts` stays covered there and has no test here. The suite continues in
// `webgpuVisibilityDrawLayers.test.ts` for the per-image draw modules.

const fakeSetup = (overrides: Partial<WebgpuPagesSetup> = {}) =>
  ({
    roots: [],
    bootstrap: [],
    slots: 4,
    cap: 4,
    pageBytes: 12,
    ...overrides,
  }) as unknown as WebgpuPagesSetup;

// webgpuPagesStateVis.ts
test('createWebgpuVisState starts with drawLayerSlots at one and no coplanar layer pipelines', () => {
  const vis = createWebgpuVisState();
  assert.equal(vis.drawLayerSlots, 1);
  assert.deepEqual(vis.visLayerPipelines, []);
});

// webgpuPagesLayout.ts
test('createWebgpuPagesLayout sizes world corners per drawable row, for the GPU partition', () => {
  const layout = createWebgpuPagesLayout(fakeSetup());
  // Per-slot counts no longer live here: the GPU partition writes them into the compaction buffer.
  // What the layout still holds is the corners that partition reads.
  assert.equal(layout.cornerPacked.length, layout.drawSlots * CORNER_VALUES);
  assert.equal(layout.drawItemWords.length, layout.drawSlots * DRAW_ITEM_U32);
});

// webgpuPagesPipelineFor.ts
test('visSlotPipeline and visPipelineFor route a coplanar-layer slot to its own pipeline set, not the layer-0 one', () => {
  const pipelines = Array.from({ length: 10 }, (_, i) => ({
    id: i,
  })) as unknown as GPURenderPipeline[];
  const rt = {
    vis: { drawLayerSlots: 2, visLayerPipelines: pipelines },
  } as unknown as WebgpuPagesCore;
  assert.equal(visSlotPipeline(rt, BASE_SLOTS), pipelines[0], 'layer 1, occluder, back cull');
  const rec = {
    material: new THREE.MeshBasicMaterial(),
    matrix: new THREE.Matrix4(),
    depthLayer: 1,
  } as unknown as PageRec;
  assert.equal(
    visPipelineFor(rt, rec),
    pipelines[0],
    'a layered cluster draws through its layer pipeline, not the base one',
  );
});

// webgpuPagesPrepareVisibility.ts (orchestration: drawLayerSlots and the layer pipelines it builds)
test('a page marked with a coplanar depth layer makes prepare() build that layer’s pipelines and report it', async () => {
  installGpuGlobals();
  const scene = quadScene();
  (scene.metadata.primitives[0].pages[1] as { depthLayer?: number }).depthLayer = 3;
  const { device } = mockGpu();
  const events: Array<{ phase: string; context?: Record<string, unknown> }> = [];
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  });
  try {
    await backend.prepare();
    const ready = events.find((event) => event.phase === 'coplanar-layers-ready');
    assert.ok(ready, 'a layered page triggers the coplanar-layers-ready diagnostic');
    assert.equal(ready!.context!.layers, 3);
    assert.ok((ready!.context!.pipelines as number) > 0, 'at least one layer pipeline was built');
  } finally {
    await backend.dispose();
    scene.geometry.dispose();
    scene.material.dispose();
  }
});

// webgpuPagesDrops.ts
test('dropVis collapses the coplanar layer pipelines and drawLayerSlots back to one', () => {
  const vis = createWebgpuVisState();
  vis.drawLayerSlots = 4;
  vis.visLayerPipelines = [{} as GPURenderPipeline, {} as GPURenderPipeline];
  const layout = createWebgpuPagesLayout(fakeSetup({ slots: 1, cap: 1 }));
  const rt = {
    vis,
    layout,
    run: createWebgpuRunState(),
    gpu: { bindGroups: new Map() },
    blendState: createWebgpuBlendState(),
    capabilities: { materials: '', unsupported: [] as string[] },
  } as unknown as WebgpuPagesRuntime;
  dropVis(rt);
  assert.equal(vis.drawLayerSlots, 1);
  assert.deepEqual(vis.visLayerPipelines, []);
});
