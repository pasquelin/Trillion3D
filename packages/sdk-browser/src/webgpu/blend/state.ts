import type { Primitive } from '../../../../sdk-core/src/index.ts'
import type { HostMesh } from '../../host/resources.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { MatrixElements } from '../../math/matrixElements.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { FRUSTUM_PLANE_VALUES, type DiagnosticMode } from '../../../../sdk-core/src/index.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import type { BlendLighting } from '../core/bindEntries.ts'
import type { BlendOverdraw } from './overdraw.ts'
import type { TransparentCompaction } from '../transparent/compact.ts'
import type { TransparentOcclusion } from '../../gpu/core/transparentOcclusion.ts'
import type { TransparentTable } from '../transparent/table.ts'
import type { BlendExpand } from './expand.ts'
import type { OrderStep } from './orderSteps.ts'
import { createWaterBounds } from '../water/bounds.ts'
import type { WaterPass } from '../water/waterPass.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { BLEND_VIEW_SIZE } from './uniforms.ts'
import { createBlendHierarchy } from './hierarchy.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { FloatAtlas } from '../core/floatAtlas.ts'

export type BlendGpuItem = {
  /** Whole-copy static inputs and computed outputs in the existing float pool. */
  deformation?: Primitive['deformation']
  deformInput?: number
  deformOutput?: number
  deformBounds?: Float64Array
  /** The material transmits: the item is drawn in the transmission pass, not in the blend. */
  transmissive?: boolean
  /** Own positions; absent for a paged item that reads its quantized pages. */
  position?: GPUBuffer
  /** Own index buffer of an unpaged primitive; a paged one reads the page cache instead. */
  index?: GPUBuffer
  uv?: GPUBuffer
  /** Its normal atlas, or the float pool's (`../core/floatAtlas.ts`). */
  normal?: FloatAtlas
  surface: PageSurface
  count: number
  matrix: MatrixElements
  /** The row posing the item when its mesh is placed by rows: skipped while it is parked. */
  placement?: PlacementOf
  /** True while the host hides the source mesh or one of its ancestors: skipped as a parked
   *  row's item is (`placement/hidden.ts`). */
  hidden?: boolean
  sourceMesh?: HostMesh
  sourceGeometry: Geometry
  /** World box of the item, six bounds flat (`packages/sdk-core/src/math/primitives/box.ts`); absent, the item is not rejected. */
  bounds?: Float64Array
  /** Buffer this box occupies, allocated once for the item when the frustum can reject it.
   *  Absent, the item never has a box; present, `bounds` points at it or is `undefined` because
   *  the bounds obtained were not usable (`worlds.ts`). */
  worldBox?: Float64Array
  /** Material flags (`../../visibility/types.ts`) in the low sixteen bits; above them the one-based water
   *  rank of a transmissive item, zero for a blend (`../water/surfaceWgsl.ts`). */
  flags: number
  /** Its own bind group, by the slot of the identity it names (`identity`). */
  groups?: (GPUBindGroup | undefined)[]
  paged?: boolean
  /** Rank of a paged item in the transparent table: the base its instances are written at. */
  pagedIndex?: number
  /** Base of its cluster list in the transparent table, zero for an unpaged item. */
  tableBase?: number
  /** First vertex of its geometry in the concatenated buffers, zero for an unpaged item. */
  vertexBase?: number
  /** Square of the eye-to-world-box-centre distance and its source rank, which breaks equal keys:
   *  the fallback pass's sort (`orderVisibleBlend`). Required: `refreshEyeKeys` sets them on
   *  every item before that sort, and the comparator reads a number, never a maybe — a defaulted
   *  value would rank an item “by eye” instead of being seen. */
  orderKey: number
  orderRank: number
}

/** Reused transparent draw lists and GPU resources for one backend instance. */
export function createWebgpuBlendState() {
  /** Words of the view uniform, allocated once. */
  const view = new Float32Array(BLEND_VIEW_SIZE / 4)
  const blendGpu: BlendGpuItem[] = []
  const visibleBlend: BlendGpuItem[] = []
  const state = {
    blendGpu,
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
    /** The entries whose pages a rewrite bounded elsewhere since the corners left, sent
     *  again alone (`refreshTransparentCorners`); none when `to` is below `from`. */
    occlusionMoved: { from: Infinity, to: -1 },
    /** Instances a CPU cut wrote, and the placements it selected. */
    cpuInstances: new Uint32Array(0),
    cpuInstanceCount: 0,
    cpuSelectedPlacements: new Set<MatrixElements>(),
    /** Table entries changed by the residency journal, awaiting a partial upload. */
    dirtySpans: new Set<number>(),
    /** Instances each item drew this image; only a CPU cut counts them, a GPU cut does not. */
    cpuItemCounts: new Uint32Array(0),
    /** The fallback pass's draws of the image, three words each (`fallback.ts`). */
    fallbackDraws: [] as number[],
    /** What the transparent groups currently name: a moved identity voids them. Two are held,
     *  with the groups of each: the shadow maps' tables a lit pass binds are double-buffered, and
     *  their frames take turns. */
    identity: createWebgpuBindIdentity(2),
    /** Lighting resources of the image, resolved once by `encodeBlend`: the blends, the water
     *  surfaces and the water composite bind the same. */
    lighting: undefined as BlendLighting | undefined,
    /** How many transparent items transmit: zero means no backdrop is allocated, and the water pass
     *  does not exist of the scene. `transmissiveInView` is how many the frustum kept this image:
     *  zero, and the pass is not encoded (`order.ts`). */
    transmissive: 0,
    transmissiveInView: 0,
    waterBounds: createWaterBounds(),
    /** Volume of each transmissive item, at its water rank, written with the records. */
    volumePacked: new Float32Array(0) as Float32Array<ArrayBuffer>,
    /** The water pass — surface pipelines and composite — of a scene that transmits, mounted with
     *  the blend pipelines; absent, the transmission slice draws as a blend (`../water/pass.ts`). */
    water: undefined as WaterPass | undefined,
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
    /** Plan entries a pass can carry at most, and the regions each occupies in the plan and
     *  argument buffers (`planLayout.ts`). */
    maxPlanEntries: 1,
    planRegions: [] as { seeds: number; order: number; runs: number; args: number }[],
    /** One bit per item: the frustum verdict of the frame, and true as long as a word of the mask
     *  has changed since the last write to the GPU. */
    keepPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    keepMoved: true,
    /** Box tree the frustum verdict walks: built per item list, refit on a move (`hierarchy.ts`). */
    hierarchy: createBlendHierarchy(),
    /** Static tables of the encoding plan (`plan.ts`). */
    drawsPacked: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** Seeded entries of each pass — blend, then transmission —, in source order, a double-sided
     *  item's back before its face (`plan.ts`). Like everything that goes per pass, indexed by
     *  the pass. */
    seeds: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    /** Pipeline of each pass's main class, -1 for a pass without one (`runs.ts`). */
    mainPipeline: [-1, -1],
    /** The items that draw their own slots, and each item's rank among them, `NOT_OWN` for the
     *  others (`runs.ts`). */
    ownItems: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    ownRanks: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** Each pass's own entries, seed indices in paint order: seeded in source order, reordered in
     *  place every frame (`order.ts`). */
    ownSeeds: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    /** This frame's slot of each own entry, in paint order, and the own entry each slot draws,
     *  -1 for a gap of the main class (`runs.ts`). */
    ownSlots: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    slotOwns: [new Int32Array(0), new Int32Array(0)] as Int32Array<ArrayBuffer>[],
    /** Slots of each pass (`runs.ts`), and those the frame draws: none without an eye. */
    slotCounts: [0, 0],
    runCount: [0, 0],
    /** Each item's sort key by source rank: the own items' every frame, every item's on the CPU
     *  model and the fallback pass (`order.ts`). */
    orderKeys: new Float64Array(0),
    /** The order kernel's dispatches of each pass and their uniform words (`orderSteps.ts`). */
    orderSteps: [[], []] as OrderStep[][],
    orderStepWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** Where the frame data holds the own keys and each pass's own seeds and slots, and its words;
     *  the eye comes first (`order.ts`). Two views of one buffer, rewritten every frame. */
    frameLayout: { ownKeys: 0, ownSeeds: [0, 0], ownSlots: [0, 0], words: 0 },
    frameDoubles: new Float64Array(0) as Float64Array<ArrayBuffer>,
    frameWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** Key records of the items, two views of one buffer (`keyRecords.ts`). */
    keyPacked: new Float64Array(0) as Float64Array<ArrayBuffer>,
    keyWords: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    /** The plan changed since the GPU last received it: seeds, dispatches, key records. */
    planMoved: true,
    /** The CPU model's paint order of each pass, seed indices, and its runs: a device without a
     *  compute stage only (`expandCpu.ts`). */
    paintOrders: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    runs: [new Uint32Array(0), new Uint32Array(0)] as Uint32Array<ArrayBuffer>[],
    /** Triangles unpaged items submit in each pass, twice for a double-sided item: a scene count,
     *  built with the plan, not a frame count. */
    blendTriangles: 0,
    transmissionTriangles: 0,
    /** A blend of the plan filters the display value (`filtersDisplay`), built with the plan. */
    filtersDisplay: false,
    /** The blending modes the plan draws, built with it: what a later change must compile for. */
    planModes: [] as Blending[],
    /** Bind group ALL paged items share, by identity slot. */
    pagedGroups: [] as (GPUBindGroup | undefined)[],
  }
  return state
}
