import { deformedOf } from '../../deformation/source.ts'
import { placementDeformation } from '../../deformation/placementSource.ts'
import { BOX_VALUES } from '../../../../sdk-core/src/index.ts'
import type { BlendCopy } from '../../cluster/blendCopyContract.ts'
import type { BlendHostScene } from '../../cluster/blendSceneRecord.ts'
import { refreshBlendBounds } from './worlds.ts'
import {
  FLAG_BACK,
  FLAG_CLUSTER_PAGE,
  FLAG_DOUBLE,
  FLAG_HAS_COLOR,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_LIT,
  FLAG_PAGED,
  FLAG_TRANSMISSIVE,
} from '../../visibility/buffer.ts'
import { WATER_RANK_SHIFT } from '../water/rank.ts'
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts'
import { ensureWebgpuPositionBuffer } from '../core/positions.ts'
import { ensureBlendIndexBuffer, ensureBlendNormalAtlas, ensureBlendUvBuffer } from './buffers.ts'
import type { createWebgpuBlendState } from './state.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'
type BlendState = ReturnType<typeof createWebgpuBlendState>

/** What every copy of a prepare reads: the device, the GPU state whose buffers it shares, and the
 *  deformation capacities of the placements met so far. */
type BlendItemContext = {
  device: GPUDevice
  gpu: WebgpuGpuState
  capacities: Parameters<typeof placementDeformation>[2]
}

/** Creates forward transparent GPU items, one per copy — per placement —, in source mesh order. */
export function prepareWebgpuBlend(
  device: GPUDevice,
  blendCopies: readonly BlendCopy[],
  gpu: WebgpuGpuState,
  blendState: BlendState,
  scene: BlendHostScene,
) {
  const ctx: BlendItemContext = { device, gpu, capacities: new Map() }
  let transmissive = 0
  for (const copy of blendCopies) {
    // Its water rank, one-based and compact over the transmissive items: the next one, taken only
    // by an item that transmits.
    const item = blendItemOf(copy, ctx, transmissive + 1)
    if (!item) continue
    if (item.transmissive) transmissive++
    refreshBlendBounds(item)
    blendState.blendGpu.push(item)
    scene.remove(copy)
  }
  return transmissive
}

/** The item of one copy, `waterRank` its rank should it transmit; none for a copy without
 *  positions or indices. */
function blendItemOf(
  copy: BlendCopy,
  { device, gpu, capacities }: BlendItemContext,
  waterRank: number,
) {
  // A transmissive surface goes through the same prepare as the other blends: it differs only
  // at draw, where the water pass composes it over the frozen backdrop instead of blending it.
  const mat = copy.surface
  const transmits = mat.transmission > 0
  const attr = copy.geometry.attributes.position,
    idx = copy.geometry.getIndex()
  if (!attr || !idx) return undefined
  const paged = !!copy.userData.pagedBlend
  const source = placementDeformation(copy.placement, copy.userData.sourceMesh ?? {}, capacities)
  const pooled = !paged && !!deformedOf(source.mesh, copy, copy.matrix, source.capacity)
  // A paged primitive whose clusters carry quantized geometry pages reads every attribute from
  // them, in place in the page cache (`../../visibility/shader/pageGeometryWgsl.ts`): it owns no
  // buffer at all. One without reads the concatenated source geometry: no positions of its own.
  const fromPages = !!copy.userData.pageGeometry
  const position =
    fromPages || paged || pooled
      ? undefined
      : ensureWebgpuPositionBuffer(device, copy.geometry.attributes, gpu.positionBuffers, gpu)!
  // A paged primitive reads its indices from the page cache, cluster by cluster: it owns none.
  // The other three buffers belong to the geometry, not the placement: nine instances of one
  // object write them once. The bytes are the same, the item order too.
  const index = paged ? undefined : ensureBlendIndexBuffer(device, idx, gpu)
  const uv =
    paged || pooled ? undefined : ensureBlendUvBuffer(device, copy.geometry.attributes, gpu)
  const normal =
    paged || pooled ? undefined : ensureBlendNormalAtlas(device, copy.geometry.attributes, gpu)
  return {
    transmissive: transmits,
    deformation: copy.deformation,
    position,
    index,
    uv,
    ownUv1: paged || pooled ? undefined : !!copy.geometry.attributes.uv1,
    normal,
    surface: mat,
    count: paged ? 0 : idx.count,
    matrix: copy.matrix,
    placement: copy.placement,
    sourceMesh: copy.userData.sourceMesh,
    sourceGeometry: copy.geometry,
    worldBox: blendWorldBox(copy, pooled),
    bounds: undefined as Float64Array | undefined,
    flags: blendFlags(copy, paged, fromPages, transmits ? waterRank : 0),
    paged,
  }
}

/** The flags of a copy's item; a transmissive one's water rank `waterRank` rides above them: the
 *  surface stage writes it and the composite reads the item's volume at that rank. */
function blendFlags(copy: BlendCopy, paged: boolean, fromPages: boolean, waterRank: number) {
  const mat = copy.surface,
    { attributes } = copy.geometry
  let flags = 0
  if (mat.lit) flags |= FLAG_LIT
  if (mat.doubleSided) flags |= FLAG_DOUBLE
  // Its own atlas may hold a second UV set alone (`buffers.ts`): the normals are the geometry's.
  if (attributes.normal) flags |= FLAG_HAS_NORMAL
  // A page stores no tangent: the fragment stage rebuilds the frame, as the opaque resolve does.
  if (attributes.tangent && !fromPages) flags |= FLAG_HAS_TANGENT
  if (mat.vertexColors && attributes.color) flags |= FLAG_HAS_COLOR
  if (mat.backSide) flags |= FLAG_BACK
  if (paged) flags |= FLAG_PAGED
  if (fromPages) flags |= FLAG_CLUSTER_PAGE
  if (waterRank) flags |= FLAG_TRANSMISSIVE | (waterRank << WATER_RANK_SHIFT)
  return flags
}

/**
 * No transform is baked here: the item carries the live world matrix of its source mesh, and its
 * box is SET by the same path that will refresh it after a move. The world box stays conservative
 * under rotation, mirror, non-uniform scale and shear — `boxTransform` guarantees that, not a
 * decomposition. A surface never culled (`neverCulled`) takes none either.
 */
function blendWorldBox(copy: BlendCopy, pooled: boolean) {
  if (pooled || !copy.frustumCulled || neverCulled(copy.surface)) return undefined
  if (!copy.geometry.boundingBox) copy.geometry.computeBoundingBox()
  return copy.geometry.boundingBox ? new Float64Array(BOX_VALUES) : undefined
}
