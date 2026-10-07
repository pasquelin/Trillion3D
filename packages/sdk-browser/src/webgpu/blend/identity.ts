import {
  blendBindEntries,
  type BlendBindResources,
  type BlendLighting,
} from '../core/blendBindEntries.ts'
import { liveResources } from '../core/liveEntries.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import type { BlendGpuItem } from './state.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** The deferred stand-ins' normal atlas: one row of zeros (`../visibility/receiver.ts`). */
const emptyNormals = (rt: WebgpuPagesRuntime) => rt.gpu.deferred?.placeholders.emptyNormals

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
      // An item without normals reads the empty normal atlas: zeros, as the zero buffer read.
      normals: () => (item ? (item.normal?.view ?? emptyNormals(rt)) : rt.vis.concatNrm),
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
      physical: () => rt.vis.physicalTable.view,
    }),
  )
}

/** The representative paged group covers the resources shared by every item. Also publishes the
 *  image's `lighting` on `blendState`, which the live entries and the water pass read. */
export function voidStaleBlendGroups(rt: WebgpuPagesRuntime, lighting: BlendLighting) {
  const { vis, blendState } = rt,
    identity = blendState.identity
  blendState.lighting = lighting
  identity.entries[0] ??= blendEntries(rt)
  if (!identity.entriesMoved(vis.blendBindGroupLayout)) return
  const { slot } = identity
  blendState.pagedGroups[slot] = undefined
  for (const item of blendState.blendGpu) if (item.groups) item.groups[slot] = undefined
}
