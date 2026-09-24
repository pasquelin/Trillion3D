import type { HostAttributes } from '../../../host/resources.ts';
import type { Texture } from '../../../../../sdk-core/src/index.ts';
import type { GpuPartition } from '../../../gpu/partition/types.ts';
import { SHADE_UNIFORM_WORDS } from '../../../visibility/shader/request.ts';
import type { GpuHiz } from '../../../gpu/hiz/hiz.ts';
import type { GpuRaster } from '../../../gpu/raster/raster.ts';
import type { GpuDraw } from '../../../gpu/draw/draw.ts';
import type { GpuRestCompact } from '../../../gpu/raster/restCompact.ts';
import { MAX_DRAW_SLOTS } from '../../../gpu/draw/draw.ts';
import type { WebgpuTileStreamer } from '../../tile/streamer.ts';
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../core/bindIdentity.ts';
import { createPresentClasses, type PresentClasses } from '../../core/materialPasses.ts';
import type { GeometryBlock } from '../../row/pageRowMaterial.ts';
import type { BlendModePipelines } from '../../blend/stagePipelines.ts';

/** GPU resources of the visibility-buffer path: raster and shade pipelines, their bind groups, the
 *  concatenated geometry, the page table and the material atlases. */
export interface WebgpuVisState {
  visEnabled: boolean;
  visTexture: GPUTexture | undefined;
  visView: GPUTextureView | undefined;
  visPipelineBack: GPURenderPipeline | undefined;
  visPipelineBackCw: GPURenderPipeline | undefined;
  visPipelineNone: GPURenderPipeline | undefined;
  visPipelineFront: GPURenderPipeline | undefined;
  visPipelineFrontCw: GPURenderPipeline | undefined;
  /** Material depth: each pixel's class, written once per image and tested by every class pass. */
  materialDepthTexture: GPUTexture | undefined;
  materialDepthView: GPUTextureView | undefined;
  materialDepthPipeline: GPURenderPipeline | undefined;
  /** One resolve pipeline per class, by class key (`../../../visibility/shader/materialClass.ts`): the scene's
   *  classes at preparation, and any class a material changed into since, made on first draw. */
  shadePipelines: Map<number, GPURenderPipeline>;
  shadePipelineFor: ((key: number) => GPURenderPipeline) | undefined;
  /** Classes the image being encoded has rows of (`../../core/materialPasses.ts`). */
  presentClasses: PresentClasses;
  gpuHiz: GpuHiz | undefined;
  gpuRaster: GpuRaster | undefined;
  visHizRestBack: GPURenderPipeline | undefined;
  visHizRestNone: GPURenderPipeline | undefined;
  visHizRestFront: GPURenderPipeline | undefined;
  /**
   * Pipelines of coplanar layers above 0: same modules and same states as layer 0, plus the layer's
   * depth bias in hardware units. A scene with no stacked coplanar surface creates none and draws
   * exactly as before.
   */
  visLayerPipelines: Array<GPURenderPipeline | undefined>;
  /** One more than the scene's deepest coplanar layer; 1 when there is none. */
  drawLayerSlots: number;
  /** GPU partition of the image: projection, split and occlusion bounds per row. */
  gpuPartition: GpuPartition | undefined;
  visBindGroupLayout: GPUBindGroupLayout | undefined;
  visBindGroup: GPUBindGroup | undefined;
  visHizBindGroup: GPUBindGroup | undefined;
  visUniform: GPUBuffer | undefined;
  zeroFlags: GPUBuffer | undefined;
  // The textured forward pipelines share the visibility path's atlases and fall with it.
  blendBindGroupLayout: GPUBindGroupLayout | undefined;
  blendPipelines: BlendModePipelines | undefined;
  gpuDraw: GpuDraw | undefined;
  /** Compaction of the tested half, between the occlusion test and the second pass. */
  gpuRestCompact: GpuRestCompact | undefined;
  shadeBindGroupLayout: GPUBindGroupLayout | undefined;
  shadeBindGroup: GPUBindGroup | undefined;
  // Raster slots × tested-or-not, and the small-triangle groups by flag source × selection: both
  // sets are built from buffers that outlive the frame, so a frame never rebuilds a bind group.
  visSlotGroups: Array<GPUBindGroup | undefined>;
  rasterGroups: Array<unknown>;
  /** What those groups, and the resolve's, currently name: a moved identity voids them. */
  visIdentity: WebgpuBindIdentity;
  shadeIdentity: WebgpuBindIdentity;
  concatPos: GPUBuffer | undefined;
  concatUv: GPUBuffer | undefined;
  concatNrm: GPUBuffer | undefined;
  pageTable: GPUBuffer | undefined;
  shadeUniform: GPUBuffer | undefined;
  /** Virtual textures: the two pools, their page tables, image feedback. */
  textures: WebgpuTileStreamer | undefined;
  mapsSampler: GPUSampler | undefined;
  shadeUniPacked: Float32Array<ArrayBuffer>;
  visUniPacked: Float32Array<ArrayBuffer>;
  geometryBlocks: Map<HostAttributes, GeometryBlock>;
  mapLayer: Map<Texture, number>;
  dataLayer: Map<Texture, number>;
}

export function createWebgpuVisState(): WebgpuVisState {
  return {
    visEnabled: false,
    visTexture: undefined,
    visView: undefined,
    visPipelineBack: undefined,
    visPipelineBackCw: undefined,
    visPipelineNone: undefined,
    visPipelineFront: undefined,
    visPipelineFrontCw: undefined,
    materialDepthTexture: undefined,
    materialDepthView: undefined,
    materialDepthPipeline: undefined,
    shadePipelines: new Map(),
    shadePipelineFor: undefined,
    presentClasses: createPresentClasses(),
    gpuHiz: undefined,
    gpuRaster: undefined,
    visHizRestBack: undefined,
    visHizRestNone: undefined,
    visHizRestFront: undefined,
    visLayerPipelines: [],
    drawLayerSlots: 1,
    gpuPartition: undefined,
    visBindGroupLayout: undefined,
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
    pageTable: undefined,
    shadeUniform: undefined,
    textures: undefined,
    mapsSampler: undefined,
    shadeUniPacked: new Float32Array(SHADE_UNIFORM_WORDS),
    visUniPacked: new Float32Array(7 * 64),
    geometryBlocks: new Map(),
    mapLayer: new Map(),
    dataLayer: new Map(),
  };
}
