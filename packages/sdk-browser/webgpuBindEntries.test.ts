import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import { createWebgpuShadePipelines } from './webgpuVisibilityPipelines.ts';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { visGroupFor } from './webgpuVisibilityDrawer.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { buildBlendStatics } from './webgpuBlendPlan.ts';
import { orderBlendPasses } from './webgpuBlendOrder.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { BASE_SLOTS, MAX_DRAW_SLOTS } from './gpuDraw.ts';
import { createGpuRaster } from './gpuRaster.ts';
import type { WebgpuTileStreamer } from './webgpuTileStreamer.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

// Defect this test catches: a layout gains a binding and only one of its two constructors
// binds it. The real device answers “Number of entries (10) did not match the expected number
// of entries (12)”, then loses it; no test saw it.

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

/** Streamer in the shape constructors read: one pool and one table per atlas, plus feedback. */
function stubTextures() {
  const atlas = () => ({
    pool: { view: {} as GPUTextureView },
    pages: { buffer: {} as GPUBuffer },
  });
  return {
    color: atlas(),
    data: atlas(),
    feedback: { buffer: {} as GPUBuffer },
  } as unknown as WebgpuTileStreamer;
}

/** Everything a constructor reads on `rt.vis`: tokens, only their count is checked here. */
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
    textures: stubTextures(),
    mapsSampler: {} as GPUSampler,
    gpuHiz: undefined,
    visSlotGroups: new Array(MAX_DRAW_SLOTS * 2).fill(undefined),
    gpuDraw: { indirectBuffer: token(), instanceBuffer: token(), slotOffsetsBuffer: token() },
  };
}

test('each bind-group constructor binds exactly the entries of its layout', async () => {
  installGpuGlobals();
  const groups: Recorded[] = [];
  const device = recordingDevice(groups);
  const { visBindGroupLayout, visModule } = await createWebgpuVisibilityShaders(device, 8);
  void visModule;
  const { shadeBindGroupLayout } = await createWebgpuShadePipelines(
    device,
    {} as GPUShaderModule,
    [],
  );
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
  // The transparent pass encodes one RUN at a time, and the unpaged item is a run on its own.
  const blendState = createWebgpuBlendState();
  blendState.blendGpu.push(item as unknown as (typeof blendState.blendGpu)[number]);
  buildBlendStatics(blendState);
  blendState.orders[0] = Uint32Array.from([1]);
  orderBlendPasses(blendState, [0, 0, 0]);
  Object.assign(blendState, { argsBuffer: {}, itemBuffer: {}, viewBuffer: {} });
  const rt = {
    vis,
    gpu: {
      cache: { buffer: {} },
      uniformBuffer: {},
      zeroUv: {},
      targetSize: [4, 4],
      colorView: {},
      depthView: {},
      volumeBuffer: {},
      backdrop: { colorView: {}, depthView: {}, active: false },
      deferred: {
        placeholders: { slices: {}, atlasView: {}, sampler: {}, bounceGrid: {}, probes: {} },
      },
      gpuDrawCalls: 0,
    },
    lights: { buffer: {}, shadows: undefined, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // `lit` view with no light: the contract lights, so the pass binds its default resources.
    sunFar: { gpu: undefined },
    blendState,
    run: { gpuDrawCalls: 0, blendDrawCalls: 0, blendSubmittedTriangles: 0 },
  } as unknown as WebgpuPagesRuntime;

  // Both constructors of `visBindGroupLayout`: the direct group and that of an indirect slot.
  ensureWebgpuVisibilityBindings(rt, device);
  assert.ok(visGroupFor(rt, device, BASE_SLOTS, false), 'the slot group is built');
  // Both constructors of `shadeBindGroupLayout`: prepare goes through the same shared list as
  // this one, replayed here after the group is invalidated.
  ensureWebgpuShadeBindings(rt, device);
  // Both constructors of `blendBindGroupLayout`: the group ALL paged items share, then that of
  // an unpaged item, on its own buffers.
  const stub = (noms: string[]) =>
    Object.fromEntries(noms.map((nom) => [nom, () => {}])) as unknown as GPURenderPassEncoder;
  const pass = stub(['setViewport', 'setBindGroup', 'setPipeline', 'draw', 'drawIndirect', 'end']);
  drawBlendPass(rt, device, { beginRenderPass: () => pass } as unknown as GPUCommandEncoder);

  // The unique constructor of the small-triangle software raster, fifth pair of the path: it
  // reads the same colour pool and the same page table as the other passes.
  const smallPass = stub(['setBindGroup', 'setPipeline', 'dispatchWorkgroups', 'end']);
  const smallEncoder = {
    clearBuffer() {},
    copyBufferToBuffer() {},
    beginComputePass: () => ({ ...smallPass, dispatchWorkgroupsIndirect() {} }),
    beginRenderPass: () => pass,
  } as unknown as GPUCommandEncoder;
  const raster = createGpuRaster(device, 4, 4, 8);
  const buffer = {} as GPUBuffer,
    view = {} as GPUTextureView;
  const rasterInput = {
    indices: buffer,
    positions: buffer,
    pages: buffer,
    hizFlags: buffer,
    uniform: buffer,
    uvs: buffer,
    textures: vis.textures,
    sampler: vis.mapsSampler,
    pageRows: 1,
    maxTriangles: 3,
    idsView: view,
    depthView: view,
    tested: false,
    groups: [],
    groupKey: 0,
  };
  raster.encodeOccluders(smallEncoder, rasterInput);
  raster.encodeIds(smallEncoder, rasterInput);

  const counted = groups.map((group) => [group.entries.length, group.layout.entries.length]);
  assert.equal(counted.length, 7, 'the six constructors ran, the resolver included');
  for (const [built, expected] of counted)
    assert.equal(built, expected, `a group binds ${built} entries for a layout of ${expected}`);
  assert.deepEqual(
    counted.slice(0, 5),
    [
      [visCount, visCount],
      [visCount, visCount],
      [shadeCount, shadeCount],
      [blendCount, blendCount],
      [blendCount, blendCount],
    ],
    'in order: direct group, slot group, hardware resolve, paged then unpaged transparents',
  );
});
