import type { GpuPartition } from './gpuPartitionTypes.ts';
import { SHADE_UNIFORM_WORDS } from './visibilityShaderShadowRequest.ts';
import type * as THREE from 'three';
import type { GpuHiz } from './gpuHiz.ts';
import type { GpuRaster } from './gpuRaster.ts';
import type { GpuDraw } from './gpuDraw.ts';
import type { GpuRestCompact } from './gpuRestCompact.ts';
import { MAX_DRAW_SLOTS } from './gpuDraw.ts';
import type { WebgpuTileStreamer } from './webgpuTileStreamer.ts';

type GeometryBlock = {
  vertexBase: number;
  count: number;
  hasUv: boolean;
  hasNormal: boolean;
  hasTangent: boolean;
};

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
  shadePipeline: GPURenderPipeline | undefined;
  gpuHiz: GpuHiz | undefined;
  gpuRaster: GpuRaster | undefined;
  visHizRestBack: GPURenderPipeline | undefined;
  visHizRestNone: GPURenderPipeline | undefined;
  visHizRestFront: GPURenderPipeline | undefined;
  /**
   * Pipelines des couches coplanaires au-dessus de 0 : mêmes modules et mêmes états que la couche 0,
   * plus le décalage de profondeur de la couche en unités matérielles. Une scène sans surface
   * coplanaire empilée n'en crée aucun et dessine exactement comme avant.
   */
  visLayerPipelines: Array<GPURenderPipeline | undefined>;
  /** Une de plus que la couche coplanaire la plus profonde de la scène ; 1 quand il n'y en a pas. */
  drawLayerSlots: number;
  /** La partition GPU de l'image : projection, partage et bornes d'occultation par ligne. */
  gpuPartition: GpuPartition | undefined;
  visBindGroupLayout: GPUBindGroupLayout | undefined;
  visBindGroup: GPUBindGroup | undefined;
  visHizBindGroup: GPUBindGroup | undefined;
  visUniform: GPUBuffer | undefined;
  zeroFlags: GPUBuffer | undefined;
  // The textured forward pipelines share the visibility path's atlases and fall with it.
  blendBindGroupLayout: GPUBindGroupLayout | undefined;
  pipelineBlendTextured: GPURenderPipeline | undefined;
  pipelineBlendFront: GPURenderPipeline | undefined;
  pipelineBlendBack: GPURenderPipeline | undefined;
  gpuDraw: GpuDraw | undefined;
  /** La compaction de la moitié testée, entre le test d'occultation et la seconde passe. */
  gpuRestCompact: GpuRestCompact | undefined;
  shadeBindGroupLayout: GPUBindGroupLayout | undefined;
  shadeBindGroup: GPUBindGroup | undefined;
  // Raster slots × tested-or-not, and the small-triangle groups by flag source × selection: both
  // sets are built from buffers that outlive the frame, so a frame never rebuilds a bind group.
  visSlotGroups: Array<GPUBindGroup | undefined>;
  rasterGroups: Array<unknown>;
  concatPos: GPUBuffer | undefined;
  concatUv: GPUBuffer | undefined;
  concatNrm: GPUBuffer | undefined;
  pageTable: GPUBuffer | undefined;
  shadeUniform: GPUBuffer | undefined;
  /** Les textures virtuelles : les deux pools, leurs tables de pages, le retour d'image. */
  textures: WebgpuTileStreamer | undefined;
  mapsSampler: GPUSampler | undefined;
  shadeUniPacked: Float32Array<ArrayBuffer>;
  visUniPacked: Float32Array<ArrayBuffer>;
  geometryBlocks: Map<THREE.BufferGeometry['attributes'], GeometryBlock>;
  mapLayer: Map<THREE.Texture, number>;
  dataLayer: Map<THREE.Texture, number>;
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
    shadePipeline: undefined,
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
    pipelineBlendTextured: undefined,
    pipelineBlendFront: undefined,
    pipelineBlendBack: undefined,
    gpuDraw: undefined,
    gpuRestCompact: undefined,
    shadeBindGroupLayout: undefined,
    shadeBindGroup: undefined,
    visSlotGroups: new Array(MAX_DRAW_SLOTS * 2).fill(undefined),
    rasterGroups: new Array(8).fill(undefined),
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
