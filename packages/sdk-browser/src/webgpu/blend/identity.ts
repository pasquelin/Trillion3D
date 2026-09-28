import {
  blendBindEntries,
  type BlendBindResources,
  type BlendLighting,
} from '../core/bindEntries.ts';
import { entriesIdentity } from '../core/bindIdentity.ts';
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

export function blendFallbackEntries(rt: WebgpuPagesRuntime, item?: BlendGpuItem) {
  return fallbackBindEntries(
    () => item?.index ?? rt.gpu.cache?.buffer,
    () => item?.position ?? rt.gpu.zeroUv,
    () => rt.gpu.uniformBuffer,
  );
}

/** The representative paged and fallback groups cover the resources shared by every item. */
export function voidStaleBlendGroups(rt: WebgpuPagesRuntime, lighting?: BlendLighting) {
  const { gpu, vis, blendState } = rt,
    identity = blendState.identity,
    { next } = identity;
  blendState.lighting = lighting;
  identity.entries[0] ??= blendEntries(rt);
  identity.entries[1] ??= blendFallbackEntries(rt);
  next[0] = vis.blendBindGroupLayout;
  next[1] = gpu.bindGroupLayout;
  let at = entriesIdentity(identity.entries[0], next, 2);
  at = entriesIdentity(identity.entries[1], next, at);
  next.length = at;
  if (!identity.moved()) return;
  blendState.pagedGroup = undefined;
  for (const item of blendState.blendGpu) item.group = undefined;
}
