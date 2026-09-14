import * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';

export type BlendGpuItem = {
  position: GPUBuffer;
  index: GPUBuffer;
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
  cut?: PageRec[];
  packed?: Uint32Array<ArrayBuffer>;
  diagnosticBuffer?: GPUBuffer;
  diagnosticData?: Uint32Array<ArrayBuffer>;
  diagnosticCut?: PageRec[];
  diagnosticMode?: DiagnosticMode;
};

/** Reused transparent draw lists and GPU resources for one backend instance. */
export function createWebgpuBlendState() {
  const blendGpu: BlendGpuItem[] = [];
  const pagedBlendGpu = new Map<THREE.Mesh, BlendGpuItem>();
  const blendCuts = new Map<BlendGpuItem, PageRec[]>();
  const blendDrawnPages: PageRec[] = [];
  const visibleBlend: BlendGpuItem[] = [];
  const blendFrustum = new THREE.Frustum();
  return { blendGpu, pagedBlendGpu, blendCuts, blendDrawnPages, visibleBlend, blendFrustum };
}
