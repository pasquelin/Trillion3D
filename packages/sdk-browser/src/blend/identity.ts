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
      planInstances: () => rt.blendState.expandedBuffer ?? rt.gpu.zeroUv,
      clusterSpans: () => rt.blendState.compaction?.spanBuffer ?? rt.gpu.zeroUv,
      directLights: () => rt.blendState.lighting?.directLights,
      shadowData: () => rt.blendState.lighting?.shadowData,
      shadowAtlas: () => rt.blendState.lighting?.shadowAtlas,
      shadowSampler: () => rt.blendState.lighting?.shadowSampler,
      shadowPool: () => rt.blendState.lighting?.shadowPool,
      shadowView: () => rt.blendState.lighting?.shadowView,
      shadowNoise: () => rt.blendState.lighting?.shadowNoise,
      tileLights: () => rt.blendState.lighting?.tileLights,
      frontTraced: () => rt.blendState.lighting?.frontTraced,
      surfaceFlags: () => rt.blendState.lighting?.surfaceFlags,
      fogCubemap: () => rt.blendState.lighting?.fogCubemap,
      fogVolume: () => rt.blendState.lighting?.fogVolume,
      fogSampler: () => rt.blendState.lighting?.fogSampler,
      fogTiles: () => rt.blendState.lighting?.fogTiles,
      lightFunctionAtlas: () => rt.blendState.lighting?.lightFunctionAtlas,
      translucencyVolume: () => rt.blendState.lighting?.translucencyVolume,
      translucencyGi: () => rt.blendState.lighting?.translucencyGi,
      translucencyGiSampler: () => rt.blendState.lighting?.translucencyGiSampler,
      lightProfileAtlas: () => rt.blendState.lighting?.lightProfileAtlas,
      lightProfileSampler: () => rt.blendState.lighting?.lightProfileSampler,
      volumeCamera: () => rt.blendState.lighting?.volumeCamera,
      cloudShade: () => rt.blendState.lighting?.cloudShade,
      cloudFog: () => rt.blendState.lighting?.cloudFog,
      material: () => rt.vis.materialTable.view,
      frame: () => rt.gpu.device && rt.vis.graphFrame.bufferOn(rt.gpu.device),
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
