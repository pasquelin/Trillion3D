import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { depthLayerBias } from '../sdk-core/index.ts';
import { BASE_SLOTS, BIN_BACK, DRAW_ITEM_U32, MAX_DRAW_SLOTS, slotCount } from './gpuDraw.ts';
import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuVisState } from './webgpuPagesStateVis.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { buildWebgpuVisibilityItems } from './webgpuVisibilityItems.ts';
import { drawVis } from './webgpuVisibilityDrawer.ts';
import { visUniformSlots } from './webgpuVisibilityUniforms.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import { createWebgpuCoplanarLayerPipelines } from './webgpuVisibilityPipelines.ts';

// Suite de `webgpuPagesLayersState.test.ts` : les modules du dessin par image, où le lot des couches
// coplanaires a lui aussi été réappliqué. `webgpuPageRow.ts` reste couvert par
// `webgpuPages.19.test.ts` et n'a pas de test ici.

// webgpuVisibilityItems.ts
test('buildWebgpuVisibilityItems packs each row’s coplanar layer into its item word and its own bin slot', () => {
  const material = new THREE.MeshBasicMaterial();
  const recA = {
    array: Uint32Array.from([0, 1, 2]),
    depthLayer: 0,
    material,
    matrix: new THREE.Matrix4(),
  } as unknown as PageRec;
  const recB = {
    array: Uint32Array.from([0, 1, 2]),
    depthLayer: 5,
    material,
    matrix: new THREE.Matrix4(),
  } as unknown as PageRec;
  // Les deux lignes du tableau de pages portent les trois indices que chaque page dessine.
  const rowWords = PAGE_INFO_STRIDE / 4;
  const pageTableInts = new Uint32Array(2 * rowWords);
  pageTableInts[ROW_INDEX_WORDS] = 3;
  pageTableInts[rowWords + ROW_INDEX_WORDS] = 3;
  const layout = {
    rows: {
      packedCount: 2,
      packedRecs: [recA, recB],
      packedPageIndex: Int32Array.from([0, 1]),
      pageTableInts,
    },
    hizRest: new Uint8Array(2),
    drawItemWords: new Uint32Array(2 * DRAW_ITEM_U32),
    binInstances: new Uint32Array(MAX_DRAW_SLOTS),
    drawRestBits: new Uint32Array(1),
    hizTestedBounds: new Float64Array(2 * HIZ_BOUNDS_VALUES),
    hizBounds: new Float64Array(2 * HIZ_BOUNDS_VALUES),
    hizTestedRows: new Uint32Array(2),
    hizTestedTriangles: new Uint32Array(2),
  };
  const rt = {
    layout,
    vis: { drawLayerSlots: 3 },
    timing: { lastItemsMs: 0 },
  } as unknown as WebgpuPagesRuntime;
  buildWebgpuVisibilityItems(rt, false, true);
  assert.equal(
    layout.drawItemWords[0 * DRAW_ITEM_U32 + 3],
    0,
    'layer-0 row keeps layer 0 in its item word',
  );
  assert.equal(
    layout.drawItemWords[1 * DRAW_ITEM_U32 + 3],
    2,
    'a deeper layer than the scene has slots for clamps to the last one (drawLayerSlots - 1)',
  );
  assert.equal(
    layout.binInstances[BASE_SLOTS * 2 + BIN_BACK],
    1,
    'the clamped layer gets its own slot count, not the layer-0 one',
  );
  assert.equal(layout.binInstances[BIN_BACK], 1, 'the layer-0 row still counts at the base slot');
});

// webgpuVisibilityDrawer.ts
test('drawVis draws each coplanar layer’s non-empty slots through its own indirect command, in the same order as layer 0', () => {
  const drawCalls: number[] = [];
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    drawIndirect(_buffer: unknown, offset: number) {
      drawCalls.push(offset);
    },
  } as unknown as GPURenderPassEncoder;
  const device = { createBindGroup: (desc: unknown) => desc } as unknown as GPUDevice;
  const binInstances = new Uint32Array(MAX_DRAW_SLOTS);
  binInstances[BASE_SLOTS + BIN_BACK] = 1; // layer 1, occluder, back cull: the only non-empty slot
  const rt = {
    vis: {
      drawLayerSlots: 2,
      visLayerPipelines: [{} as GPURenderPipeline],
      visBindGroupLayout: {},
      concatPos: {},
      concatUv: {},
      pageTable: {},
      visUniform: {},
      colorAtlas: { classes: [{ view: {} }, { view: {} }] },
      mapsSampler: {},
      zeroFlags: {},
      slots: { color: {}, data: {} },
      gpuHiz: undefined,
      visSlotGroups: new Array(MAX_DRAW_SLOTS * 2).fill(undefined),
      gpuDraw: { indirectBuffer: {}, instanceBuffer: {}, slotOffsetsBuffer: {} },
    },
    gpu: { cache: { buffer: {} } },
    run: { gpuDrawCalls: 0 },
    layout: { rows: { packedCount: 0 }, binInstances, hizRest: new Uint8Array(0) },
  } as unknown as WebgpuPagesRuntime;

  drawVis(rt, device, pass, false, true, true);

  assert.deepEqual(
    drawCalls,
    [(BASE_SLOTS + BIN_BACK) * 16],
    'only the layer-1 slot drew, at its own indirect offset',
  );
  assert.equal(rt.run.gpuDrawCalls, 1);
});

// webgpuVisibilityUniforms.ts
test('visUniformSlots grows the visibility uniform slot count with the scene’s coplanar layers', () => {
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), slotCount(1) + 1);
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), 7);
  assert.equal(visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState), slotCount(3) + 1);
});

// webgpuVisibilityShaders.ts
test('createWebgpuVisibilityShaders sizes the visibility uniform buffer for the scene’s coplanar layer count', async () => {
  installGpuGlobals();
  const device = {
    createBuffer: ({ size, usage }: { size: number; usage: number }) => ({ size, usage }),
    createBindGroupLayout: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
  } as unknown as GPUDevice;
  const uniformSlots = visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState);
  const shaders = await createWebgpuVisibilityShaders(device, 8, uniformSlots);
  assert.equal(uniformSlots, 19);
  assert.equal((shaders.visUniform as unknown as { size: number }).size, uniformSlots * 256);
});

// webgpuVisibilityPipelines.ts
test('createWebgpuCoplanarLayerPipelines builds five cull pipelines per extra layer, each biased, and none for layerSlots = 1', async () => {
  installGpuGlobals();
  const created: Array<{ cullMode?: GPUCullMode; depthBias?: number }> = [];
  const device = {
    createPipelineLayout: () => ({}),
    createRenderPipeline: (desc: {
      primitive?: { cullMode?: GPUCullMode };
      depthStencil?: { depthBias?: number };
    }) => {
      created.push({ cullMode: desc.primitive?.cullMode, depthBias: desc.depthStencil?.depthBias });
      return {};
    },
  } as unknown as GPUDevice;
  const visModule = {} as GPUShaderModule;
  const bindGroupLayout = {} as GPUBindGroupLayout;

  const none = await createWebgpuCoplanarLayerPipelines(
    device,
    visModule,
    bindGroupLayout,
    true,
    1,
  );
  assert.deepEqual(none, [], 'a scene with no stacked coplanar surface creates no layer pipeline');

  const two = await createWebgpuCoplanarLayerPipelines(device, visModule, bindGroupLayout, true, 2);
  assert.equal(two.length, 10, 'five cull modes, occluder and tested, for the one extra layer');
  assert.ok(
    created.slice(-10).every((entry) => entry.depthBias === depthLayerBias(1)),
    'every pipeline of layer 1 carries that layer’s depth bias',
  );
});
