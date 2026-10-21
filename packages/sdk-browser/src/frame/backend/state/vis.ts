import { createMaterialTable, type MaterialTable } from '../../../materials/table/materialTable.ts'
import type { DeformationCompute } from '../../../deformation/compute.ts'
import type * as DeformationCode from '../../../deformation/deformationCode.ts'
import type { SessionDeformation } from '../../../deformation/session.ts'
import type { HostAttributes } from '../../../session/host/resources.ts'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'
import { SHADE_UNIFORM_WORDS } from '../../../visibility/shader/request.ts'
import type { GpuHiz } from '../../../visibility/hiz/gpu/types.ts'
import type { ReflectionPipelines } from '../../../lighting/reflections/reflectionPipelines.ts'
import type { GpuRaster } from '../../../visibility/raster/raster.ts'
import type { GpuDraw } from '../../../visibility/draw/contract.ts'
import { MAX_DRAW_SLOTS } from '../../../visibility/draw/contract.ts'
import type { WebgpuTileStreamer } from '../../../materials/virtual/streamer/streamer.ts'
import {
  createWebgpuBindIdentity,
  type WebgpuBindIdentity,
} from '../../../gpu/bind/bindIdentity.ts'
import { RenderBundles } from '../../../gpu/core/renderBundles.ts'
import { createPresentClasses } from '../../../materials/classes/materialPasses.ts'
import type { GeometryBlock } from '../../../geometry/rows/page/pageRowMaterial.ts'
import type { VertexPool } from '../../../geometry/pages/pool/geometryPool.ts'
import type { prepareWebgpuGeometry } from '../../../geometry/pages/pool/geometryPrepare.ts'
import type { BlendModePipelines } from '../../../blend/stagePipelines.ts'
import type { PresentClasses } from '../../../gpu/core/presentClasses.ts'
import type { ShadeBins } from '../../../materials/classes/shadeBins.ts'
import type { ShadeCache } from '../../../visibility/passes/shadeCache.ts'
import type { VoxelSteps } from '../../../visibility/passes/voxelSteps.ts'
import type { ShadeClasses } from '../../../visibility/passes/shadePipelines.ts'
import type { ShadeCensus } from '../../../visibility/passes/shadeCensus.ts'
import type { FeedbackAside } from '../../prepare/feedbackVariant.ts'

/** GPU resources of the visibility-buffer path: raster and shade pipelines, their bind groups, the
 *  concatenated geometry, the page table and the material atlases. */
export interface WebgpuVisState {
  /** Deformation's code, loaded by a session that deforms (`../../../deformation/prepare.ts`). */
  deformationCode?: typeof DeformationCode
  deformationCompute?: DeformationCompute
  pooledDeformation?: { table: GPUBuffer; count: number }
  /** An opaque row has shown a surface as-is: the image's flags are read (`../../../geometry/rows/page/pageRowWriter.ts`). */
  asIsShown: boolean
  visTexture: GPUTexture | undefined
  visView: GPUTextureView | undefined
  visPipelineBack: GPURenderPipeline | undefined
  visPipelineNone: GPURenderPipeline | undefined
  visPipelineFront: GPURenderPipeline | undefined
  /** The resolve's pipeline of each class (`../../../visibility/passes/shadePipelines.ts`): the scene's
   *  classes at preparation, and any class a material changed into since, asked before the image
   *  that draws it. */
  shadeClasses: ShadeClasses | undefined
  /** The classes of the scene's surfaces, taken again once what they read moved
   *  (`../../../visibility/passes/shadeCensus.ts`). */
  shadeCensus: ShadeCensus | undefined
  /** Classes the image being encoded has rows of (`../../../materials/classes/materialPasses.ts`). */
  presentClasses: PresentClasses
  /** The image's pixels sorted by class, each class's bin (`../../../materials/classes/shadeBins.ts`). */
  shadeBins: ShadeBins | undefined
  /** What the frame composes once for the resolve (`../../../visibility/passes/shadeCache.ts`). */
  shadeCache: ShadeCache | undefined
  /** The voxel trace's counters the resolve binds (`../../../visibility/passes/voxelSteps.ts`). */
  voxelSteps: VoxelSteps | undefined
  /** Whether the resolve and blend pipelines in place write the texture feedback: the drawn
   *  view then has its target (`../../prepare/feedbackVariant.ts`). */
  writesFeedback: boolean
  /** The other variant, while it compiles for a scene whose textures came or went. */
  feedbackAside?: FeedbackAside
  /** Whether the resolve pipelines in place write the emission-and-occlusion layer: the drawn
   *  view's surfaces then have it (`../../prepare/emissiveAoLayer.ts`). */
  writesEmissiveAo: boolean
  /** Set once an opaque row's surface can emit or occlude (`surfaceEmitsOrOccludes`): from then on
   *  the image writes the layer. Never unset, as `asIsShown`. */
  emissiveAoShown: boolean
  gpuHiz: GpuHiz | undefined
  /** The reflection's kernels (`../../../lighting/reflections/gpu.ts`), made with the Hi-Z. */
  reflectionPipelines: ReflectionPipelines | undefined
  /** The visibility buffer both rasters write, the cluster split and the software raster
   *  (`../../../visibility/raster/raster.ts`). */
  gpuRaster: GpuRaster | undefined
  /** One more than the scene's deepest coplanar layer; 1 when there is none. */
  drawLayerSlots: number
  visBindGroupLayout: GPUBindGroupLayout | undefined
  visUniform: GPUBuffer | undefined
  /** Zeros for every visibility row, bound where a pass has nothing to read
   *  (`../../../visibility/passes/shaders.ts`). */
  zeroRows: GPUBuffer | undefined
  // The textured forward pipelines share the visibility path's atlases and fall with it.
  blendBindGroupLayout: GPUBindGroupLayout | undefined
  blendPipelines: BlendModePipelines | undefined
  gpuDraw: GpuDraw | undefined
  shadeBindGroupLayout: GPUBindGroupLayout | undefined
  shadeBindGroup: GPUBindGroup | undefined
  // The raster slots' groups, built from buffers that outlive the frame, so a frame never rebuilds
  // a bind group; the software raster holds its own (`../../../visibility/raster/bindings.ts`).
  visSlotGroups: Array<GPUBindGroup | undefined>
  /** Moved each time the slot groups are voided: what the slot bundles are keyed by. */
  visGroupsRevision: number
  /** What those groups, and the resolve's, currently name: a moved identity voids them. */
  visIdentity: WebgpuBindIdentity
  /** The render bundles of the raster's slot draws — main pass's half then post pass's, in the depth
   *  phase then in the identifier phase (`../../../visibility/passes/drawer.ts`): recorded again
   *  only when what decides their commands moved. */
  visBundles: [RenderBundles, RenderBundles, RenderBundles, RenderBundles]
  shadeIdentity: WebgpuBindIdentity
  concatPos: GPUBuffer | undefined
  concatUv: GPUBuffer | undefined
  /** The normal atlas's view (`../../../gpu/core/floatAtlas.ts`). */
  concatNrm: GPUTextureView | undefined
  /** The pool those three buffers are (`../../../geometry/pages/pool/geometryPool.ts`). */
  vertexPool: VertexPool | undefined
  /** Draws the pool again for what a source added to the session brings (`prepareWebgpuGeometry`). */
  extendGeometry: ReturnType<typeof prepareWebgpuGeometry>['extendGeometry'] | undefined
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
  /** The surfaces' records every pass reads (`../../../materials/table/materialTable.ts`). */
  materialTable: MaterialTable
}

export function createWebgpuVisState(): WebgpuVisState {
  return {
    asIsShown: false,
    visTexture: undefined,
    visView: undefined,
    visPipelineBack: undefined,
    visPipelineNone: undefined,
    visPipelineFront: undefined,
    shadeClasses: undefined,
    shadeCensus: undefined,
    presentClasses: createPresentClasses(),
    shadeBins: undefined,
    shadeCache: undefined,
    voxelSteps: undefined,
    writesFeedback: true,
    writesEmissiveAo: true,
    emissiveAoShown: false,
    gpuHiz: undefined,
    reflectionPipelines: undefined,
    gpuRaster: undefined,
    drawLayerSlots: 1,
    visBindGroupLayout: undefined,
    visUniform: undefined,
    zeroRows: undefined,
    blendBindGroupLayout: undefined,
    blendPipelines: undefined,
    gpuDraw: undefined,
    shadeBindGroupLayout: undefined,
    shadeBindGroup: undefined,
    visSlotGroups: new Array(MAX_DRAW_SLOTS).fill(undefined),
    visGroupsRevision: 0,
    visIdentity: createWebgpuBindIdentity(),
    // Two keys each: a tested half compacted or not.
    visBundles: [
      new RenderBundles(2),
      new RenderBundles(2),
      new RenderBundles(2),
      new RenderBundles(2),
    ],
    shadeIdentity: createWebgpuBindIdentity(),
    concatPos: undefined,
    concatUv: undefined,
    concatNrm: undefined,
    vertexPool: undefined,
    extendGeometry: undefined,
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
    materialTable: createMaterialTable(),
  }
}
