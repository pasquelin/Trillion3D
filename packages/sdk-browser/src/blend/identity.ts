import {
  blendBindEntries,
  type BlendBindResources,
  type BlendLighting,
} from '../gpu/bind/blendBindEntries.ts'
import { liveResources } from '../gpu/bind/liveEntries.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/** One resource contract for construction and invalidation, with owners read lazily: the page
 *  cache and the float pool every item reads. */
export function blendEntries(rt: WebgpuPagesRuntime) {
  return blendBindEntries(
    liveResources<BlendBindResources>({
      indices: () => rt.gpu.cache?.buffer,
      positions: () => rt.vis.concatPos,
      uvs: () => rt.vis.concatUv,
      uniform: () => rt.blendState.viewBuffer,
      uniformSize: () => BLEND_VIEW_SIZE,
      items: () => rt.blendState.itemBuffer,
      textures: () => rt.vis.textures,
      sampler: () => rt.vis.mapsSampler,
      normals: () => rt.vis.concatNrm,
      clusterDiagnostic: () => rt.blendState.compaction?.diagnosticBuffer ?? rt.gpu.zeroUv,
      planInstances: () => rt.blendState.expandedBuffer ?? rt.gpu.zeroUv,
      clusterSpans: () => rt.blendState.compaction?.spanBuffer ?? rt.gpu.zeroUv,
      directLights: () => rt.blendState.lighting?.directLights,
      shadowData: () => rt.blendState.lighting?.shadowData,
      shadowAtlas: () => rt.blendState.lighting?.shadowAtlas,
      shadowSampler: () => rt.blendState.lighting?.shadowSampler,
      shadowTransmittance: () => rt.blendState.lighting?.shadowTransmittance,
      shadowPool: () => rt.blendState.lighting?.shadowPool,
      shadowView: () => rt.blendState.lighting?.shadowView,
      shadowNoise: () => rt.blendState.lighting?.shadowNoise,
      bounceGrid: () => rt.blendState.lighting?.bounceGrid,
      probes: () => rt.blendState.lighting?.probes,
      tileLights: () => rt.blendState.lighting?.tileLights,
      frontTraced: () => rt.blendState.lighting?.frontTraced,
      material: () => rt.vis.materialTable.view,
    }),
  )
}

/** The one group covers the resources shared by every item. Also publishes the
 *  image's `lighting` on `blendState`, which the live entries read. */
export function voidStaleBlendGroups(rt: WebgpuPagesRuntime, lighting: BlendLighting) {
  const { vis, blendState } = rt,
    identity = blendState.identity
  blendState.lighting = lighting
  identity.entries[0] ??= blendEntries(rt)
  if (!identity.entriesMoved(vis.blendBindGroupLayout)) return
  const { slot } = identity
  blendState.sharedGroups[slot] = undefined
}
