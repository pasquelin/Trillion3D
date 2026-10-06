import type { DeformationCompute } from '../../../deformation/compute.ts'
import type * as DeformationCode from '../../../deformation/deformationCode.ts'
import type { SessionDeformation } from '../../../deformation/session.ts'
import type { HostAttributes } from '../../../host/resources.ts'
import type { Texture } from '../../../../../sdk-core/src/index.ts'
import type { GpuPartition } from '../../../gpu/partition/types.ts'
import { SHADE_UNIFORM_WORDS } from '../../../visibility/shader/request.ts'
import type { GpuHiz } from '../../../gpu/hiz/hiz.ts'
import type { GpuRaster } from '../../../gpu/raster/raster.ts'
import type { GpuDraw } from '../../../gpu/draw/draw.ts'
import type { GpuRestCompact } from '../../../gpu/raster/restCompact.ts'
import { MAX_DRAW_SLOTS } from '../../../gpu/draw/draw.ts'
import type { WebgpuTileStreamer } from '../../tile/streamer.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../core/bindIdentity.ts'
import { createPresentClasses } from '../../core/materialPasses.ts'
import type { GeometryBlock } from '../../row/pageRowMaterial.ts'
import type { VertexPool } from '../../core/geometryPool.ts'
import type { BlendModePipelines } from '../../blend/stagePipelines.ts'
import { type PresentClasses } from '../../core/presentClasses.ts'
import type { MaterialTiles } from '../../core/materialTiles.ts'
import type { ShadeCache } from '../../visibility/shadeCache.ts'
import type { ShadeClasses } from '../../visibility/shadePipelines.ts'
import type { ShadeCensus } from '../../visibility/shadeCensus.ts'
import type { FeedbackAside } from '../prepare/feedbackVariant.ts'

/** GPU resources of the visibility-buffer path: raster and shade pipelines, their bind groups, the
 *  concatenated geometry, the page table and the material atlases. */
export interface WebgpuVisState {
  /** Deformation's code, loaded by a session that deforms (`../../../deformation/prepare.ts`). */
  deformationCode?: typeof DeformationCode
  deformationCompute?: DeformationCompute
  wholeDeformation?: { table: GPUBuffer; count: number }
  visEnabled: boolean
  /** An opaque row has shown a surface as-is: the image's flags are read (`../../row/pageRow.ts`). */
  asIsShown: boolean
  visTexture: GPUTexture | undefined
  visView: GPUTextureView | undefined
  visPipelineBack: GPURenderPipeline | undefined
  visPipelineBackCw: GPURenderPipeline | undefined
  visPipelineNone: GPURenderPipeline | undefined
  visPipelineFront: GPURenderPipeline | undefined
  visPipelineFrontCw: GPURenderPipeline | undefined
  /** The resolve's pipeline of each class (`../../visibility/shadePipelines.ts`): the scene's
   *  classes at preparation, and any class a material changed into since, asked before the image
   *  that draws it. */
  shadeClasses: ShadeClasses | undefined
  /** The classes of the scene's surfaces, taken again once what they read moved
   *  (`../../visibility/shadeCensus.ts`). */
  shadeCensus: ShadeCensus | undefined
  /** Classes the image being encoded has rows of (`../../core/materialPasses.ts`). */
  presentClasses: PresentClasses
  /** The screen tiles each class draws (`../../core/materialTiles.ts`). */
  materialTiles: MaterialTiles | undefined
  /** What the frame composes once for the resolve (`../../visibility/shadeCache.ts`). */
  shadeCache: ShadeCache | undefined
  /** Whether the resolve, blend and water pipelines in place write the texture feedback: the drawn
   *  view then has its target (`../prepare/feedbackVariant.ts`). */
  writesFeedback: boolean
  /** The other variant, while it compiles for a scene whose textures came or went. */
  feedbackAside?: FeedbackAside
  /** Whether the resolve pipelines in place write the emission-and-occlusion layer: the drawn
   *  view's surfaces then have it (`../prepare/emissiveAoLayer.ts`). */
  writesEmissiveAo: boolean
  /** Set once an opaque row's surface can emit or occlude (`surfaceEmitsOrOccludes`): from then on
   *  the image writes the layer. Never unset, as `asIsShown`. */
  emissiveAoShown: boolean
  gpuHiz: GpuHiz | undefined
  gpuRaster: GpuRaster | undefined
  visHizRestBack: GPURenderPipeline | undefined
  visHizRestNone: GPURenderPipeline | undefined
  visHizRestFront: GPURenderPipeline | undefined
  /**
   * Pipelines of coplanar layers above 0: same modules and same states as layer 0, plus the layer's
   * depth bias in hardware units. A scene with no stacked coplanar surface creates none and draws
   * with layer 0 alone.
   */
  visLayerPipelines: Array<GPURenderPipeline | undefined>
  /** One more than the scene's deepest coplanar layer; 1 when there is none. */
  drawLayerSlots: number
  /** GPU partition of the image: projection, split and occlusion bounds per row. */
  gpuPartition: GpuPartition | undefined
  visBindGroupLayout: GPUBindGroupLayout | undefined
  /** The visibility module, kept to make its raster pipelines again without Hi-Z. */
  visModule: GPUShaderModule | undefined
  visBindGroup: GPUBindGroup | undefined
  visHizBindGroup: GPUBindGroup | undefined
  visUniform: GPUBuffer | undefined
  zeroFlags: GPUBuffer | undefined
  // The textured forward pipelines share the visibility path's atlases and fall with it.
  blendBindGroupLayout: GPUBindGroupLayout | undefined
  blendPipelines: BlendModePipelines | undefined
  gpuDraw: GpuDraw | undefined
  /** Compaction of the tested half, between the occlusion test and the second pass. */
  gpuRestCompact: GpuRestCompact | undefined
  shadeBindGroupLayout: GPUBindGroupLayout | undefined
  shadeBindGroup: GPUBindGroup | undefined
  // Raster slots × tested-or-not, and the small-triangle groups by flag source × selection: both
  // sets are built from buffers that outlive the frame, so a frame never rebuilds a bind group.
  visSlotGroups: Array<GPUBindGroup | undefined>
  rasterGroups: Array<unknown>
  /** What those groups, and the resolve's, currently name: a moved identity voids them. */
  visIdentity: WebgpuBindIdentity
  shadeIdentity: WebgpuBindIdentity
  concatPos: GPUBuffer | undefined
  concatUv: GPUBuffer | undefined
  /** The normal atlas's view (`../../core/floatAtlas.ts`). */
  concatNrm: GPUTextureView | undefined
  /** The pool those three buffers are (`../../core/geometryPool.ts`). */
  vertexPool: VertexPool | undefined
  pageTable: GPUBuffer | undefined
  shadeUniform: GPUBuffer | undefined
  /** Virtual textures: the two pools, their page tables, image feedback. */
  textures: WebgpuTileStreamer | undefined
  mapsSampler: GPUSampler | undefined
  shadeUniPacked: Float32Array<ArrayBuffer>
  visUniPacked: Float32Array<ArrayBuffer>
  geometryBlocks: Map<HostAttributes, GeometryBlock>
  /** The session's GPU deformation, its records in the float pool's tail. */
  deformation: SessionDeformation | undefined
  mapLayer: Map<Texture, number>
  dataLayer: Map<Texture, number>
}

export function createWebgpuVisState(): WebgpuVisState {
  return {
    visEnabled: false,
    asIsShown: false,
    visTexture: undefined,
    visView: undefined,
    visPipelineBack: undefined,
    visPipelineBackCw: undefined,
    visPipelineNone: undefined,
    visPipelineFront: undefined,
    visPipelineFrontCw: undefined,
    shadeClasses: undefined,
    shadeCensus: undefined,
    presentClasses: createPresentClasses(),
    materialTiles: undefined,
    shadeCache: undefined,
    writesFeedback: true,
    writesEmissiveAo: true,
    emissiveAoShown: false,
    gpuHiz: undefined,
    gpuRaster: undefined,
    visHizRestBack: undefined,
    visHizRestNone: undefined,
    visHizRestFront: undefined,
    visLayerPipelines: [],
    drawLayerSlots: 1,
    gpuPartition: undefined,
    visBindGroupLayout: undefined,
    visModule: undefined,
    visBindGroup: undefined,
    visHizBindGroup: undefined,
    visUniform: undefined,
    zeroFlags: undefined,
    blendBindGroupLayout: undefined,
    blendPipelines: undefined,
    gpuDraw: undefined,
    gpuRestCompact: undefined,
    shadeBindGroupLayout: undefined,
    shadeBindGroup: undefined,
    visSlotGroups: new Array(MAX_DRAW_SLOTS * 2).fill(undefined),
    rasterGroups: new Array(8).fill(undefined),
    visIdentity: createWebgpuBindIdentity(),
    shadeIdentity: createWebgpuBindIdentity(),
    concatPos: undefined,
    concatUv: undefined,
    concatNrm: undefined,
    vertexPool: undefined,
    pageTable: undefined,
    shadeUniform: undefined,
    textures: undefined,
    mapsSampler: undefined,
    shadeUniPacked: new Float32Array(SHADE_UNIFORM_WORDS),
    visUniPacked: new Float32Array(7 * 64),
    geometryBlocks: new Map(),
    deformation: undefined,
    mapLayer: new Map(),
    dataLayer: new Map(),
  }
}
