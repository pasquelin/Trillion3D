import * as THREE from 'three';
import { FRUSTUM_PLANE_VALUES, type DiagnosticMode } from '../sdk-core/index.ts';
import { createWebgpuBindIdentity } from './webgpuBindIdentity.ts';
import type { BlendOverdraw } from './webgpuBlendOverdraw.ts';
import type { TransparentCompaction } from './webgpuTransparentCompact.ts';
import type { TransparentOcclusion } from './gpuTransparentOcclusion.ts';
import type { TransparentTable } from './webgpuTransparentTable.ts';
import type { BlendExpand } from './webgpuBlendExpand.ts';
import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';

export type BlendGpuItem = {
  /** The material transmits: the item is drawn in the transmission pass, not in the blend. */
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
  /** World box of the item, six bounds flat (`mathBox.ts`); absent, the item is not rejected. */
  bounds?: Float64Array;
  /** Buffer this box occupies, allocated once for the item when the frustum can reject it.
   *  Absent, the item never has a box; present, `bounds` points at it or is `undefined` because
   *  the bounds obtained were not usable (`webgpuBlendWorlds.ts`). */
  worldBox?: Float64Array;
  rgba: [number, number, number, number];
  map?: THREE.Texture;
  flags: number;
  /** Wrap of the material's six maps, one nibble each (`visibilityWrapModes.ts`). */
  wrapModes: number;
  group?: GPUBindGroup;
  paged?: boolean;
  /** Rank of a paged item in the transparent table: the base its instances are written at. */
  pagedIndex?: number;
  /** Base of its cluster list in the transparent table, zero for an unpaged item. */
  tableBase?: number;
  /** First vertex of its geometry in the concatenated buffers, zero for an unpaged item. */
  vertexBase?: number;
  /** Square of the eye-to-world-box-centre distance, reset every frame, and its source rank,
   *  which breaks equal keys (`webgpuBlendOrder.ts`). Required: `refreshEyeKeys` sets them on
   *  every item before any sort, and the comparator reads a number, never a maybe — a defaulted
   *  value would rank an item “by eye” instead of being seen. */
  orderKey: number;
  orderRank: number;
};

/** Reused transparent draw lists and GPU resources for one backend instance. */
export function createWebgpuBlendState() {
  /** Words of the view uniform, allocated once. */
  const view = new Float32Array(BLEND_VIEW_SIZE / 4);
  const blendGpu: BlendGpuItem[] = [];
  const pagedBlendGpu = new Map<THREE.Mesh, BlendGpuItem>();
  const visibleBlend: BlendGpuItem[] = [];
  const state = {
    blendGpu,
    pagedBlendGpu,
    visibleBlend,
    /** Normalised frustum planes of the frame, against which an item is rejected. */
    blendPlanes: new Float64Array(FRUSTUM_PLANE_VALUES),
    /** The scene's transparent draw order and the GPU compaction that filters it, or undefined
     *  before `prepare` built them — or when the scene carries no paged transparent cluster. */
    table: undefined as TransparentTable | undefined,
    compaction: undefined as TransparentCompaction | undefined,
    /** Hi-Z test of transparent clusters, mounted after the pyramid it depends on. */
    occlusion: undefined as TransparentOcclusion | undefined,
    /** World corners of each table entry, and the age of the table they come from. */
    occlusionCorners: new Float32Array(0) as Float32Array<ArrayBuffer>,
    occlusionEpoch: -1,
    /** Instances a CPU cut wrote, and the meshes it selected. */
    cpuInstances: new Uint32Array(0),
    cpuInstanceCount: 0,
    cpuSelectedMeshes: new Set<THREE.Mesh>(),
    /** Table entries changed by the residency journal, awaiting a partial upload. */
    dirtySpans: new Set<number>(),
    /** Instances each item drew this image; only a CPU cut counts them, a GPU cut does not. */
    cpuItemCounts: new Uint32Array(0),
    /** What the transparent groups currently name: a moved identity voids them. */
    identity: createWebgpuBindIdentity(),
    /** How many transparent items transmit: zero means no background copy is allocated or encoded,
     *  and the transmission pass does not exist of the frame. */
    transmissive: 0,
    /** Volume of each item of the draw list, at uniform write. */
    volumePacked: new Float32Array(0) as Float32Array<ArrayBuffer>,
    /** Per-catalogue-entry cluster identity, and the mode it was written for. */
    clusterIdentity: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    diagnosticMode: undefined as DiagnosticMode | undefined,
    /** Overdraw counter, mounted by the only diagnostic variant that asks for it. */
    overdraw: undefined as BlendOverdraw | undefined,
    /** Item records and the view uniform: one scene buffer, one frame buffer. */
    itemBuffer: undefined as GPUBuffer | undefined,
    itemPacked: new Float32Array(0) as Float32Array<ArrayBuffer>,
    /** Whole view of the records, on the same buffer: allocated with them, never per frame. */
    itemInts: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    viewBuffer: undefined as GPUBuffer | undefined,
    viewPacked: view,
    viewInts: new Uint32Array(view.buffer),
    /** Kernel that expands the sorted plan, and the two buffers it — or its fallback — writes: the
     *  instance list the shader reads, and one indirect argument per run. */
    expand: undefined as BlendExpand | undefined,
    expandedBuffer: undefined as GPUBuffer | undefined,
    expandedPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    argsBuffer: undefined as GPUBuffer | undefined,
    argsPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** What the vertex index shifts to name the first instance of its run, and the vertices of a
     *  paged cluster — the stride of every shared run. */
    vertexShift: 2,
    maxVertexWords: 3,
    /** Instances the scene can expand, and where each pass starts its own. */
    instanceCapacity: 1,
    instanceBase: [0, 0],
    /** Plan entries a pass can carry at most, and the regions each occupies in the plan, run and
     *  argument buffer (`webgpuBlendExpand.ts`). */
    maxPlanEntries: 1,
    planRegions: [] as { order: number; runs: number; args: number }[],
    /** One bit per item: the frustum verdict of the frame, set with the sort keys, and true as long
     *  as a word of the mask has changed since the last write to the GPU. */
    keepPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    keepMoved: true,
    /** Static tables of the encoding plan (`webgpuBlendPlan.ts`). */
    drawsPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** Seeded entries of each pass: blend, then transmission. Like `runCount`, `orderMoved` and
     *  `planRegions`, everything that goes per pass is indexed by the pass. */
    /** The same entries, in the frame's paint order: farthest to nearest. Seeded by the plan,
     *  reordered in place every frame (`webgpuBlendOrder.ts`). */
    orders: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    /** Runs of each order, rebuilt — and rewritten to the GPU — when it has moved. */
    runs: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    runCount: [0, 0],
    /** Has the order moved since the last write? A still pose writes nothing. */
    orderMoved: [true, true],
    /** Triangles unpaged items submit in each pass, twice for a double-sided item: a scene count,
     *  built with the plan, not a frame count. */
    blendTriangles: 0,
    transmissionTriangles: 0,
    /** Bind group ALL paged items share. */
    pagedGroup: undefined as GPUBindGroup | undefined,
  };
  return state;
}
