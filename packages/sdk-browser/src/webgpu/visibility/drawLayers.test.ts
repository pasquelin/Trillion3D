import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { depthLayerUnits } from '../../../../sdk-core/src/index.ts';
import { BASE_SLOTS, DRAW_ITEM_U32, MAX_DRAW_SLOTS, slotCount } from '../../gpu/draw/draw.ts';
import { ROW_INDEX_WORDS } from '../row/pageRow.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { WebgpuVisState } from '../pages/state/vis.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { createDrawItemWordsHold, refreshDrawItemWords } from './itemWords.ts';
import { drawVis } from './drawer.ts';
import { visUniformSlots } from './uniforms.ts';
import { createWebgpuVisibilityShaders } from './shaders.ts';
import { createWebgpuCoplanarLayerPipelines } from './pipelines.ts';

// Follow-up of `../pages/layersState.test.ts`: the per-image draw modules, where the coplanar-
// layer lot was reapplied too. `../row/pageRow.ts` stays covered by `../row/pageRowDepthBias.test.ts` and has
// no test here.

// itemWords.ts
test("a row's coplanar layer goes into its record word, capped, and its triangles with it", () => {
  const material = G.basicSurface();
  const rec = (depthLayer: number) =>
    ({
      array: Uint32Array.from([0, 1, 2]),
      depthLayer,
      material,
      matrix: new G.Matrix4(),
    }) as unknown as PageRec;
  // The two page-table rows carry the three indices each page draws.
  const rowWords = PAGE_INFO_STRIDE / 4;
  const pageTableInts = new Uint32Array(2 * rowWords);
  pageTableInts[ROW_INDEX_WORDS] = 3;
  pageTableInts[rowWords + ROW_INDEX_WORDS] = 9;
  const layout = {
    rows: {
      packedCount: 2,
      packedRecs: [rec(0), rec(5)],
      packedPageIndex: Int32Array.from([0, 1]),
      pageTableInts,
      tableEpoch: 1,
      rowsEpoch: 1,
      dirtyFrom: 0,
      dirtyTo: 1,
    },
    itemWordsHold: createDrawItemWordsHold(2),
    drawItemWords: new Uint32Array(2 * DRAW_ITEM_U32),
  };
  const rt = { layout, vis: { drawLayerSlots: 3 } } as unknown as WebgpuPagesRuntime;
  const hold = refreshDrawItemWords(rt, rt.vis.drawLayerSlots - 1, undefined);
  assert.equal(layout.drawItemWords[3], 0, 'the layer-0 row keeps layer 0');
  assert.equal(
    layout.drawItemWords[DRAW_ITEM_U32 + 3],
    2,
    'a layer deeper than the scene has slots pinches to the last',
  );
  assert.equal(layout.drawItemWords[4], 1, 'the row triangles leave their table row');
  assert.equal(layout.drawItemWords[DRAW_ITEM_U32 + 4], 3);
  assert.equal(hold.total, 4, 'the drawable-triangle total follows the two rows');
});

// drawer.ts
test("drawVis draws each coplanar layer's slots by their own indirect command", () => {
  const drawCalls: number[] = [];
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    drawIndirect(_buffer: unknown, offset: number) {
      drawCalls.push(offset);
    },
  } as unknown as GPURenderPassEncoder;
  const { device } = fakeDevice();
  const rt = {
    vis: {
      drawLayerSlots: 2,
      visPipelineBack: {},
      visPipelineNone: {},
      visPipelineFront: {},
      visLayerPipelines: new Array(10).fill({} as GPURenderPipeline),
      visBindGroupLayout: {},
      concatPos: {},
      concatUv: {},
      pageTable: {},
      visUniform: {},
      textures: { color: { views: [{}, {}, {}], pages: { buffer: {} } } },
      mapsSampler: {},
      zeroFlags: {},
      gpuHiz: undefined,
      visSlotGroups: new Array(MAX_DRAW_SLOTS * 2).fill(undefined),
      gpuDraw: { indirectBuffer: {}, instanceBuffer: {}, slotOffsetsBuffer: {} },
    },
    gpu: { cache: { buffer: {} } },
    run: { gpuDrawCalls: 0 },
    layout: { rows: { packedCount: 0 } },
  } as unknown as WebgpuPagesRuntime;

  drawVis(rt, device, pass, false, true);

  // The call count now depends only on the slots: three cull modes per layer, each at its own
  // indirect offset. An empty slot draws zero instances, the GPU knows that alone.
  assert.deepEqual(
    drawCalls,
    [0, 16, 32, BASE_SLOTS * 16, (BASE_SLOTS + 1) * 16, (BASE_SLOTS + 2) * 16],
    'the three slots of each layer are drawn in layer order',
  );
  assert.equal(rt.run.gpuDrawCalls, 6);
});

// uniforms.ts
test('visUniformSlots grows the visibility uniform slot count with the scene’s coplanar layers', () => {
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), slotCount(1) + 1);
  assert.equal(visUniformSlots({ drawLayerSlots: 1 } as WebgpuVisState), 7);
  assert.equal(visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState), slotCount(3) + 1);
});

// shaders.ts
test('createWebgpuVisibilityShaders sizes the visibility uniform buffer for the scene’s coplanar layer count', async () => {
  const { device } = fakeDevice();
  const uniformSlots = visUniformSlots({ drawLayerSlots: 3 } as WebgpuVisState);
  const shaders = await createWebgpuVisibilityShaders(device, 8, uniformSlots);
  assert.equal(uniformSlots, 19);
  assert.equal((shaders.visUniform as unknown as { size: number }).size, uniformSlots * 256);
});

// pipelines.ts
test('createWebgpuCoplanarLayerPipelines builds five cull pipelines per extra layer, each biased, and none for layerSlots = 1', async () => {
  const { device, renderPipelines } = fakeDevice();
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
    renderPipelines
      .slice(-10)
      .every((entry) => entry.depthStencil?.depthBias === depthLayerUnits(1)),
    'every pipeline of layer 1 carries that layer’s depth bias',
  );
});
