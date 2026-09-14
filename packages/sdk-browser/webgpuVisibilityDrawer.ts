import type { GpuDraw } from './gpuDraw.ts';
import type { PageRec } from './pageSelection.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';
type Rows = ReturnType<typeof createWebgpuRowState>;
type DrawerOptions = {
  device: GPUDevice;
  rows: Rows;
  visSlots: Array<GPURenderPipeline | undefined>;
  visSlotGroups: Array<GPUBindGroup | undefined>;
  visBindGroupLayout?: GPUBindGroupLayout;
  cacheBuffer?: GPUBuffer;
  concatPos?: GPUBuffer;
  concatUv?: GPUBuffer;
  pageTable?: GPUBuffer;
  visUniform?: GPUBuffer;
  mapsTexture?: GPUTexture;
  mapsSampler?: GPUSampler;
  zeroFlags?: GPUBuffer;
  hizFlags?: GPUBuffer;
  gpuDraw?: GpuDraw;
  mapsArrayView?: GPUTextureView;
  visBindGroup?: GPUBindGroup;
  visHizBindGroup?: GPUBindGroup;
  useIndirect: boolean;
  binInstances: Uint32Array;
  twoPass: boolean;
  hizRest: Uint8Array;
  visPipelineFor: (rec: PageRec, rest: boolean) => GPURenderPipeline | undefined;
};

/** Caches indirect slot groups and draws the occluder or tested half. */
export function createWebgpuVisibilityDrawer({
  device,
  rows,
  visSlots,
  visSlotGroups,
  visBindGroupLayout,
  cacheBuffer,
  concatPos,
  concatUv,
  pageTable,
  visUniform,
  mapsTexture,
  mapsSampler,
  zeroFlags,
  hizFlags,
  gpuDraw,
  useIndirect,
  binInstances,
  twoPass,
  hizRest,
  visPipelineFor,
  visBindGroup,
  visHizBindGroup,
  mapsArrayView: initialMapsArrayView,
}: DrawerOptions) {
  let mapsArrayView = initialMapsArrayView,
    drawCalls = 0;
  const visGroupFor = (slot: number, rest: boolean) => {
    if (
      !visBindGroupLayout ||
      !cacheBuffer ||
      !concatPos ||
      !concatUv ||
      !pageTable ||
      !visUniform ||
      !mapsTexture ||
      !mapsSampler ||
      !gpuDraw
    )
      return;
    const flags = rest ? hizFlags : zeroFlags;
    if (!flags) return;
    const key = slot * 2 + (rest ? 1 : 0);
    let group = visSlotGroups[key];
    if (!group) {
      const visMaps = (mapsArrayView ??= mapsTexture.createView({ dimension: '2d-array' }));
      group = device.createBindGroup({
        layout: visBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: cacheBuffer } },
          { binding: 1, resource: { buffer: concatPos } },
          { binding: 2, resource: { buffer: pageTable } },
          { binding: 3, resource: { buffer: flags } },
          { binding: 4, resource: { buffer: visUniform, offset: (slot + 1) * 256, size: 96 } },
          { binding: 5, resource: { buffer: concatUv } },
          { binding: 6, resource: visMaps },
          { binding: 7, resource: mapsSampler },
          { binding: 8, resource: { buffer: gpuDraw.instanceBuffer } },
          { binding: 9, resource: { buffer: gpuDraw.slotOffsetsBuffer } },
        ],
      });
      visSlotGroups[key] = group;
    }
    return group;
  };
  /** Draws the occluder half (`rest` false) or the tested half; with `twoPass` false, everything. */
  const drawVis = (pass: GPURenderPassEncoder, rest: boolean) => {
    if (useIndirect) {
      if (!gpuDraw) return;
      const start = rest ? 3 : 0;
      for (let s = start; s < start + 3; s++) {
        if (!binInstances[s]) continue;
        const pipeline = visSlots[s],
          group = visGroupFor(s, rest);
        if (!pipeline || !group) continue;
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.drawIndirect(gpuDraw.indirectBuffer, s * 16);
        drawCalls++;
      }
      return;
    }
    const group = rest ? (visHizBindGroup ?? visBindGroup) : visBindGroup;
    if (!group) return;
    for (let i = 0; i < rows.packedCount; i++) {
      if (twoPass && (hizRest[i] !== 0) !== rest) continue;
      const pipeline = visPipelineFor(rows.packedRecs[i]!, rest);
      if (!pipeline) continue;
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(rows.packedRecs[i]!.array!.length, 1, 0, i);
      drawCalls++;
    }
  };
  return {
    drawVis,
    get mapsArrayView() {
      return mapsArrayView;
    },
    get drawCalls() {
      return drawCalls;
    },
  };
}
