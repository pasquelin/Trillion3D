import {
  blendBindEntries,
  type BlendBindResources,
  type BlendLighting,
} from '../core/bindEntries.ts';
import { liveResources } from '../core/liveEntries.ts';
import { fallbackBindEntries } from '../core/fallbackEntries.ts';
import { BLEND_VIEW_SIZE } from './uniforms.ts';
import type { BlendGpuItem } from './state.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** One resource contract for construction and invalidation, with owners read lazily. */
export function blendEntries(rt: WebgpuPagesRuntime, item?: BlendGpuItem) {
  return blendBindEntries(
    liveResources<BlendBindResources>({
      indices: () => item?.index ?? rt.gpu.cache?.buffer,
      positions: () => item?.position ?? rt.vis.concatPos,
      uvs: () => (item ? (item.uv ?? rt.gpu.zeroUv) : rt.vis.concatUv),
      uniform: () => rt.blendState.viewBuffer,
      uniformSize: () => BLEND_VIEW_SIZE,
      items: () => rt.blendState.itemBuffer,
      textures: () => rt.vis.textures,
      sampler: () => rt.vis.mapsSampler,
      normals: () => (item ? (item.normal ?? rt.gpu.zeroUv) : rt.vis.concatNrm),
      clusterDiagnostic: () => rt.blendState.compaction?.diagnosticBuffer ?? rt.gpu.zeroUv,
      planInstances: () => rt.blendState.expandedBuffer ?? rt.gpu.zeroUv,
      clusterSpans: () => rt.blendState.compaction?.spanBuffer ?? rt.gpu.zeroUv,
      directLights: () => rt.blendState.lighting?.directLights,
      shadowData: () => rt.blendState.lighting?.shadowData,
      shadowAtlas: () => rt.blendState.lighting?.shadowAtlas,
      shadowSampler: () => rt.blendState.lighting?.shadowSampler,
      shadowTransmittance: () => rt.blendState.lighting?.shadowTransmittance,
      shadowTranslucentDepth: () => rt.blendState.lighting?.shadowTranslucentDepth,
      bounceGrid: () => rt.blendState.lighting?.bounceGrid,
      probes: () => rt.blendState.lighting?.probes,
      tileLights: () => rt.blendState.lighting?.tileLights,
      proxy: () => rt.blendState.lighting?.proxy,
      surfaceCache: () => rt.blendState.lighting?.surfaceCache,
    }),
  );
}

/** The representative paged and fallback groups cover the resources shared by every item. */
export function voidStaleBlendGroups(rt: WebgpuPagesRuntime, lighting?: BlendLighting) {
  const { gpu, vis, blendState } = rt,
    identity = blendState.identity;
  blendState.lighting = lighting;
  identity.entries[0] ??= blendEntries(rt);
  identity.entries[1] ??= fallbackBindEntries(rt);
  if (!identity.entriesMoved(vis.blendBindGroupLayout, gpu.bindGroupLayout)) return;
  blendState.pagedGroup = undefined;
  for (const item of blendState.blendGpu) item.group = undefined;
}
