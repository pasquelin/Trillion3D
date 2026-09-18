import type { GpuPartition } from './gpuPartitionTypes.ts';
import type * as THREE from 'three';
import type { GpuHiz } from './gpuHiz.ts';
import type { GpuRaster } from './gpuRaster.ts';
import type { GpuDraw } from './gpuDraw.ts';
import type { GpuRestCompact } from './gpuRestCompact.ts';
import { MAX_DRAW_SLOTS } from './gpuDraw.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import type { MaterialLayerIndex } from './webgpuTexturePriority.ts';
import type { WebgpuAtlas } from './webgpuAtlasCommon.ts';
import type { WebgpuAtlasSlots } from './webgpuAtlasSlots.ts';

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
  /** Les classes de taille de l'atlas couleur et de l'atlas de données. */
  colorAtlas: WebgpuAtlas | undefined;
  dataAtlas: WebgpuAtlas | undefined;
  mapsSampler: GPUSampler | undefined;
  materialScales: GPUBuffer | undefined;
  /** Classe, couche et résidence de mips de chaque slot de texture. */
  slots: WebgpuAtlasSlots | undefined;
  shadeUniPacked: Float32Array<ArrayBuffer>;
  visUniPacked: Float32Array<ArrayBuffer>;
  geometryBlocks: Map<THREE.BufferGeometry['attributes'], GeometryBlock>;
  mapLayer: Map<THREE.Texture, number>;
  dataLayer: Map<THREE.Texture, number>;
  /** Couches d'atlas que chaque matériau lit : l'ordre de transfert suit ce que la coupe dessine. */
  materialLayers: MaterialLayerIndex | undefined;
  uvScales: Array<[number, number]>;
  dataUvScales: Array<[number, number]>;
  textureJobs: TextureJob[];
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
    colorAtlas: undefined,
    dataAtlas: undefined,
    mapsSampler: undefined,
    materialScales: undefined,
    slots: undefined,
    shadeUniPacked: new Float32Array(64),
    visUniPacked: new Float32Array(7 * 64),
    geometryBlocks: new Map(),
    mapLayer: new Map(),
    dataLayer: new Map(),
    materialLayers: undefined,
    uvScales: [[1, 1]],
    dataUvScales: [[1, 1]],
    textureJobs: [],
  };
}
