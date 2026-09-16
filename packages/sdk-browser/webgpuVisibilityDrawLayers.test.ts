import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { depthLayerUnits } from '../sdk-core/index.ts';
import { BASE_SLOTS, DRAW_ITEM_U32, MAX_DRAW_SLOTS, slotCount } from './gpuDraw.ts';
import { ROW_INDEX_WORDS } from './webgpuPageRow.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuVisState } from './webgpuPagesStateVis.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { createDrawItemWordsHold, refreshDrawItemWords } from './webgpuVisibilityItemWords.ts';
import { drawVis } from './webgpuVisibilityDrawer.ts';
import { visUniformSlots } from './webgpuVisibilityUniforms.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import { createWebgpuCoplanarLayerPipelines } from './webgpuVisibilityPipelines.ts';

// Suite de `webgpuPagesLayersState.test.ts` : les modules du dessin par image, où le lot des couches
// coplanaires a lui aussi été réappliqué. `webgpuPageRow.ts` reste couvert par
// `webgpuPages.19.test.ts` et n'a pas de test ici.

// webgpuVisibilityItemWords.ts
test('la couche coplanaire d’une ligne va dans son mot de fiche, plafonnée, et ses triangles avec', () => {
  const material = new THREE.MeshBasicMaterial();
  const rec = (depthLayer: number) =>
    ({
      array: Uint32Array.from([0, 1, 2]),
      depthLayer,
      material,
      matrix: new THREE.Matrix4(),
    }) as unknown as PageRec;
  // Les deux lignes du tableau de pages portent les trois indices que chaque page dessine.
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
  assert.equal(layout.drawItemWords[3], 0, 'la ligne de couche 0 garde la couche 0');
  assert.equal(
    layout.drawItemWords[DRAW_ITEM_U32 + 3],
    2,
    'une couche plus profonde que la scène n’a de slots se pince à la dernière',
  );
  assert.equal(
    layout.drawItemWords[4],
    1,
    'les triangles de la ligne sortent de sa ligne de table',
  );
  assert.equal(layout.drawItemWords[DRAW_ITEM_U32 + 4], 3);
  assert.equal(hold.total, 4, 'le total des triangles dessinables suit les deux lignes');
});

// webgpuVisibilityDrawer.ts
test('drawVis dessine les slots de chaque couche coplanaire par leur propre commande indirecte', () => {
  const drawCalls: number[] = [];
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    drawIndirect(_buffer: unknown, offset: number) {
      drawCalls.push(offset);
    },
  } as unknown as GPURenderPassEncoder;
  const device = { createBindGroup: (desc: unknown) => desc } as unknown as GPUDevice;
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
    layout: { rows: { packedCount: 0 } },
  } as unknown as WebgpuPagesRuntime;

  drawVis(rt, device, pass, false, true);

  // Le nombre d'appels ne dépend plus que des slots : trois modes de découpe par couche, chacun
  // à son propre décalage indirect. Un slot vide dessine zéro instance, la carte le sait seule.
  assert.deepEqual(
    drawCalls,
    [0, 16, 32, BASE_SLOTS * 16, (BASE_SLOTS + 1) * 16, (BASE_SLOTS + 2) * 16],
    'les trois slots de chaque couche sont dessinés dans l’ordre des couches',
  );
  assert.equal(rt.run.gpuDrawCalls, 6);
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
    created.slice(-10).every((entry) => entry.depthBias === depthLayerUnits(1)),
    'every pipeline of layer 1 carries that layer’s depth bias',
  );
});
