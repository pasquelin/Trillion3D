import * as THREE from 'three';
import { FRUSTUM_PLANE_VALUES, type DiagnosticMode } from '../sdk-core/index.ts';
import type { BlendLighting } from './webgpuBindEntries.ts';
import type { TransparentCompaction } from './webgpuTransparentCompact.ts';
import type { TransparentTable } from './webgpuTransparentTable.ts';

export type BlendGpuItem = {
  /** Le matériau transmet : l'item est dessiné dans la passe de transmission, pas dans le mélange. */
  transmissive?: boolean;
  position: GPUBuffer;
  /** Own index buffer of an unpaged primitive; a paged one reads the page cache instead. */
  index?: GPUBuffer;
  uv?: GPUBuffer;
  normal?: GPUBuffer;
  material: THREE.Material | THREE.Material[];
  count: number;
  matrix: THREE.Matrix4;
  sourceMesh?: THREE.Mesh;
  sourceGeometry: THREE.BufferGeometry;
  /** Boîte monde de l'item, six bornes à plat (`mathBox.ts`) ; absente, l'item n'est pas rejeté. */
  bounds?: Float64Array;
  rgba: [number, number, number, number];
  map?: THREE.Texture;
  flags: number;
  group?: GPUBindGroup;
  paged?: boolean;
  /** Rank of a paged item in the transparent table: the base its instances are written at. */
  pagedIndex?: number;
};

/** Reused transparent draw lists and GPU resources for one backend instance. */
export function createWebgpuBlendState() {
  const blendGpu: BlendGpuItem[] = [];
  const pagedBlendGpu = new Map<THREE.Mesh, BlendGpuItem>();
  const visibleBlend: BlendGpuItem[] = [];
  const state = {
    blendGpu,
    pagedBlendGpu,
    visibleBlend,
    /** Plans normalisés du tronc de l'image, contre lesquels un item non paginé est rejeté. */
    blendPlanes: new Float64Array(FRUSTUM_PLANE_VALUES),
    /** The scene's transparent draw order and the GPU compaction that filters it, or undefined
     *  before `prepare` built them — or when the scene carries no paged transparent cluster. */
    table: undefined as TransparentTable | undefined,
    compaction: undefined as TransparentCompaction | undefined,
    /** Instances a CPU cut wrote, and the residency revision the spans were written from. */
    cpuInstances: new Uint32Array(0),
    cpuInstanceCount: 0,
    spanRevision: -1,
    /** Instances each item drew this image; only a CPU cut counts them, a GPU cut does not. */
    cpuItemCounts: new Uint32Array(0),
    /** Les ressources d'éclairage sur lesquelles les groupes de liaison courants ont été bâtis :
     *  l'atlas d'ombres et la grille de sondes n'arrivent qu'après les premières images. */
    lighting: undefined as BlendLighting | undefined,
    /** Combien d'items transparents transmettent : zéro veut dire qu'aucune copie de fond n'est
     *  allouée ni encodée, et que la passe de transmission n'existe pas de l'image. */
    transmissive: 0,
    /** Le volume de chaque item de la liste de dessin, à l'écriture des uniformes. */
    volumePacked: new Float32Array(0) as Float32Array<ArrayBuffer>,
    /** Per-catalogue-entry cluster identity, and the mode it was written for. */
    clusterIdentity: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    diagnosticMode: undefined as DiagnosticMode | undefined,
  };
  return state;
}
