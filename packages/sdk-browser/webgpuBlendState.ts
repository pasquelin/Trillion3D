import * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { TransparentCompaction } from './webgpuTransparentCompact.ts';
import type { TransparentTable } from './webgpuTransparentTable.ts';

export type BlendGpuItem = {
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
  bounds?: THREE.Box3;
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
  const blendFrustum = new THREE.Frustum();
  const state = {
    blendGpu,
    pagedBlendGpu,
    visibleBlend,
    blendFrustum,
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
    /** Per-catalogue-entry cluster identity, and the mode it was written for. */
    clusterIdentity: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    diagnosticMode: undefined as DiagnosticMode | undefined,
  };
  return state;
}
