import {
  blendBindEntries,
  type BlendBindResources,
  type BlendLighting,
} from '../gpu/bind/blendBindEntries.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../gpu/bind/bindIdentity.ts'
import { viewKey } from '../frame/backend/state/viewKey.ts'
import { liveResources } from '../gpu/bind/liveEntries.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/** The groups of the transparents in one view: what they currently name, the group every item shares and the one of the display-filtered
 *  pipelines (their layout is another where `blendGroupLayouts` says so), each by identity slot. */
export type BlendViewGroups = {
  identity: WebgpuBindIdentity
  sharedGroups: (GPUBindGroup | undefined)[]
  filteredGroups: (GPUBindGroup | undefined)[]
}

/** The identities each view holds. */
export const BLEND_IDENTITY_DEPTH = 4

/** The groups of the view being drawn (`viewKey`). Four identities are held (`BLEND_IDENTITY_DEPTH`), each with its groups: the shadow maps' tables a lit pass binds are
 *  double-buffered, their frames take turns, and the sky surfaces' groups (stand-ins for what the image makes later, `bindSkySurfaces`)
 *  are one more of each. */
export function blendGroupsOf(rt: WebgpuPagesRuntime) {
  const key = viewKey(rt.gpu),
    { viewGroups } = rt.blendState
  let groups = viewGroups.get(key)
  if (!groups)
    viewGroups.set(
      key,
      (groups = {
        identity: createWebgpuBindIdentity(BLEND_IDENTITY_DEPTH),
        sharedGroups: [],
        filteredGroups: [],
      }),
    )
  return groups
}

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
      rectAtlas: () => rt.blendState.lighting?.rectAtlas,
      rectSampler: () => rt.blendState.lighting?.rectSampler,
      volumeCamera: () => rt.blendState.lighting?.volumeCamera,
      cloudShade: () => rt.blendState.lighting?.cloudShade,
      cloudFog: () => rt.blendState.lighting?.cloudFog,
      material: () => rt.vis.materialTable.view,
      frame: () => rt.gpu.device && rt.vis.graphFrame.bufferOn(rt.gpu.device),
    }),
    true,
  )
}

/** The one group covers the resources shared by every item. Also publishes the
 *  image's `lighting` on `blendState`, which the live entries read. */
export function voidStaleBlendGroups(rt: WebgpuPagesRuntime, lighting: BlendLighting) {
  const { vis, blendState } = rt,
    { identity, sharedGroups, filteredGroups } = blendGroupsOf(rt)
  blendState.lighting = lighting
  identity.entries[0] ??= blendEntries(rt)
  if (!identity.entriesMoved(vis.blendBindGroupLayout)) return
  const { slot } = identity
  sharedGroups[slot] = undefined
  filteredGroups[slot] = undefined
}
