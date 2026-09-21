import type { BlendLighting } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Voids the transparent groups — the one every paged item shares and each unpaged item's own — when
 * a resource they name changed identity: the page pool after a resize, an atlas after a layer
 * change, the backdrop after the viewport, the shadow atlas and the probe grid the first frames
 * only hold stand-ins for. Read before any group is served; nothing is dropped by name elsewhere.
 * The fallback pass names no lighting: it leaves those places empty.
 */
export function voidStaleBlendGroups(rt: WebgpuPagesRuntime, lighting?: BlendLighting) {
  const { gpu, vis, blendState } = rt,
    { next } = blendState.identity,
    compaction = blendState.compaction;
  next[0] = vis.blendBindGroupLayout;
  next[1] = gpu.cache?.buffer;
  next[2] = vis.concatPos;
  next[3] = vis.concatUv;
  next[4] = vis.concatNrm;
  next[5] = blendState.viewBuffer;
  next[6] = blendState.itemBuffer;
  next[7] = vis.textures?.color.pool.view;
  next[8] = vis.textures?.data.pool.view;
  next[9] = vis.mapsSampler;
  next[10] = lighting?.directLights;
  next[11] = lighting?.shadowSlices;
  next[12] = lighting?.shadowAtlas;
  next[13] = lighting?.shadowSampler;
  next[14] = lighting?.bounceGrid;
  next[15] = lighting?.probes;
  next[16] = lighting?.tileLights;
  next[17] = lighting?.proxy;
  next[18] = compaction?.diagnosticBuffer;
  next[19] = compaction?.spanBuffer;
  next[20] = blendState.expandedBuffer;
  next[21] = gpu.volumeBuffer;
  next[22] = gpu.backdrop?.colorView;
  next[23] = gpu.backdrop?.depthView;
  next[24] = gpu.bindGroupLayout;
  next[25] = gpu.uniformBuffer;
  next[26] = gpu.zeroUv;
  if (!blendState.identity.moved()) return;
  blendState.pagedGroup = undefined;
  for (const item of blendState.blendGpu) item.group = undefined;
}
