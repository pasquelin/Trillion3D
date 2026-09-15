import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import { createWebgpuShadePipeline } from './webgpuVisibilityPipelines.ts';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { visGroupFor } from './webgpuVisibilityDrawer.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { BASE_SLOTS, MAX_DRAW_SLOTS } from './gpuDraw.ts';
import { createGpuSmallTriangles } from './gpuSmallTriangles.ts';
import { ATLAS_CLASS_COUNT } from './webgpuAtlasClasses.ts';
import type { WebgpuAtlas } from './webgpuAtlasCommon.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

// Le défaut que ce test attrape : une disposition gagne une liaison et un seul de ses deux
// constructeurs la lie. Le dispositif réel répond « Number of entries (10) did not match the
// expected number of entries (12) », puis perd le dispositif ; aucun test ne le voyait.

type Recorded = { layout: { entries: unknown[] }; entries: unknown[] };

function recordingDevice(groups: Recorded[]) {
  return {
    createBuffer: ({ size, usage }: { size: number; usage: number }) => ({ size, usage }),
    createBindGroupLayout: (desc: unknown) => desc,
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createComputePipeline: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroup: (desc: Recorded) => {
      groups.push(desc);
      return desc;
    },
  } as unknown as GPUDevice;
}

/** Un atlas de la forme que les constructeurs lisent : une classe de taille par slot de liaison. */
function stubAtlas() {
  return {
    classes: Array.from({ length: ATLAS_CLASS_COUNT }, () => ({
      view: {} as GPUTextureView,
      size: [4, 4] as [number, number],
    })),
    used: 1,
  } as unknown as WebgpuAtlas;
}

/** Tout ce qu'un constructeur lit sur `rt.vis` : des jetons, seul leur nombre est vérifié ici. */
function stubVis(layouts: Record<string, unknown>) {
  const token = () => ({}) as GPUBuffer;
  return {
    ...layouts,
    concatPos: token(),
    concatUv: token(),
    concatNrm: token(),
    pageTable: token(),
    visUniform: token(),
    shadeUniform: token(),
    zeroFlags: token(),
    visView: {} as GPUTextureView,
    colorAtlas: stubAtlas(),
    dataAtlas: stubAtlas(),
    mapsSampler: {} as GPUSampler,
    slots: { color: token(), data: token() },
    materialScales: token(),
    gpuHiz: undefined,
    visSlotGroups: new Array(MAX_DRAW_SLOTS * 2).fill(undefined),
    gpuDraw: { indirectBuffer: token(), instanceBuffer: token(), slotOffsetsBuffer: token() },
  };
}

test('chaque constructeur de groupe de liaison lie exactement les entrées de sa disposition', async () => {
  installGpuGlobals();
  const groups: Recorded[] = [];
  const device = recordingDevice(groups);
  const { visBindGroupLayout, visModule } = await createWebgpuVisibilityShaders(device, 8);
  void visModule;
  const { shadeBindGroupLayout } = await createWebgpuShadePipeline(device, {} as GPUShaderModule);
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const visCount = (visBindGroupLayout as unknown as { entries: unknown[] }).entries.length,
    shadeCount = (shadeBindGroupLayout as unknown as { entries: unknown[] }).entries.length,
    blendCount = (blendBindGroupLayout as unknown as { entries: unknown[] }).entries.length;

  const vis = stubVis({ visBindGroupLayout, shadeBindGroupLayout, blendBindGroupLayout });
  const item = {
    index: {} as GPUBuffer,
    position: {} as GPUBuffer,
    uv: {} as GPUBuffer,
    normal: {} as GPUBuffer,
    diagnosticBuffer: {} as GPUBuffer,
    material: new THREE.MeshBasicMaterial(),
    matrix: new THREE.Matrix4(),
    count: 3,
    group: undefined,
  };
  const rt = {
    vis,
    gpu: {
      cache: { buffer: {} },
      uniformBuffer: {},
      zeroUv: {},
      targetSize: [4, 4],
      colorView: {},
      depthView: {},
      deferred: {
        placeholders: { slices: {}, atlasView: {}, sampler: {}, bounceGrid: {}, probes: {} },
      },
      gpuDrawCalls: 0,
    },
    lights: { buffer: {}, shadows: undefined, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    blendState: { visibleBlend: [item], lighting: undefined },
    run: { gpuDrawCalls: 0, blendDrawCalls: 0, blendSubmittedTriangles: 0 },
  } as unknown as WebgpuPagesRuntime;

  // Les deux constructeurs de `visBindGroupLayout` : le groupe direct et celui d'un slot indirect.
  ensureWebgpuVisibilityBindings(rt, device);
  assert.ok(visGroupFor(rt, device, BASE_SLOTS, false), 'le groupe de slot est bien construit');
  // Les deux constructeurs de `shadeBindGroupLayout` : celui de la préparation passe par la même
  // liste partagée que celui-ci, rejoué ici après invalidation du groupe.
  ensureWebgpuShadeBindings(rt, device);
  // Le constructeur unique de `blendBindGroupLayout`.
  const pass = {
    setViewport() {},
    setBindGroup() {},
    setPipeline() {},
    draw() {},
    end() {},
  };
  drawBlendPass(
    rt,
    device,
    { beginRenderPass: () => pass } as unknown as GPUCommandEncoder,
    0,
    true,
  );

  // Le constructeur unique du raster logiciel des petits triangles, cinquième paire du chemin :
  // il lit les mêmes classes d'atlas et la même table de slots que les autres passes.
  const smallPass = {
    setBindGroup() {},
    setPipeline() {},
    dispatchWorkgroups() {},
    dispatchWorkgroupsIndirect() {},
    end() {},
  };
  const smallEncoder = {
    clearBuffer() {},
    copyBufferToBuffer() {},
    beginComputePass: () => smallPass,
    beginRenderPass: () => pass,
  } as unknown as GPUCommandEncoder;
  createGpuSmallTriangles(device, 4, 4, 8).encode(smallEncoder, {
    indices: {} as GPUBuffer,
    positions: {} as GPUBuffer,
    pages: {} as GPUBuffer,
    hizFlags: {} as GPUBuffer,
    uniform: {} as GPUBuffer,
    uvs: {} as GPUBuffer,
    colorAtlas: vis.colorAtlas,
    slots: vis.slots as never,
    sampler: vis.mapsSampler,
    pageRows: 1,
    maxTriangles: 3,
    idsView: {} as GPUTextureView,
    depthView: {} as GPUTextureView,
    groups: [],
    groupKey: 0,
  });

  const counted = groups.map((group) => [group.entries.length, group.layout.entries.length]);
  assert.equal(counted.length, 6, 'les cinq constructeurs ont tourné, le résolveur compris');
  for (const [built, expected] of counted)
    assert.equal(
      built,
      expected,
      `un groupe lie ${built} entrées pour une disposition de ${expected}`,
    );
  assert.deepEqual(
    counted.slice(0, 4),
    [
      [visCount, visCount],
      [visCount, visCount],
      [shadeCount, shadeCount],
      [blendCount, blendCount],
    ],
    'dans l’ordre : groupe direct, groupe de slot, résolution matérielle, transparents',
  );
});
