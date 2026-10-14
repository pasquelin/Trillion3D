import type { Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import { transparentOcclusionState } from '../transparent/entryCorners.ts'
import type { DrawSource } from '../../page/selection/drawSource.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { MatrixElements } from '../../host/matrixElements.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../../math/src/geometry/frustum/frustum.ts'
import type { DiagnosticMode } from '../../../../sdk-core/src/runtime/diagnostics.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import type { BlendLighting } from '../core/blendBindEntries.ts'
import type { BlendOverdraw } from './overdraw.ts'
import type { TransparentCompaction } from '../transparent/compact.ts'
import type { TransparentTable } from '../transparent/table.ts'
import type { WaterPass } from '../water/waterPass.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { createBlendOrderState } from './orderState.ts'
import { planState, planTotals } from './planState.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { FloatAtlas } from '../core/floatAtlas.ts'
import type { NodeIndex } from '../pages/render/movedNode.ts'

export type BlendGpuItem = {
  /** Whole-copy static inputs and computed outputs in the existing float pool. */
  deformation?: Primitive['deformation']
  deformInput?: number
  deformOutput?: number
  deformBounds?: Float64Array
  /** Its local box grown by the deformation's reach, `deformBounds` before its pose: what its
   *  deformed vertices stay in, and the water rectangle encloses (`../water/waterItems.ts`). */
  deformLocal?: Float64Array
  /** The material transmits: the item is drawn in the transmission pass, not in the blend. */
  transmissive?: boolean
  /** Its surface carries an anisotropic or clear-coat lobe, set with its record
   *  (`refreshBlendScene`): what every lobe switch of the transparent passes is derived from. */
  lobed?: boolean
  /** Own positions; absent for a paged item that reads its quantized pages. */
  position?: GPUBuffer
  /** Own index buffer of an unpaged primitive; a paged one reads the page cache instead. */
  index?: GPUBuffer
  uv?: GPUBuffer
  /** An item with buffers of its own: whether its geometry carries a second UV set, at the tail of
   *  its normal atlas (`buffers.ts`); absent, it reads the float pool's or its pages'. */
  ownUv1?: boolean
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
  drawSource?: DrawSource
  sourceGeometry: Geometry
  /** World box of the item, six bounds flat (`packages/math/src/geometry/box.ts`); absent, the item is not rejected. */
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
}

/** The blend state a session holds (`createWebgpuBlendState`). */
export type WebgpuBlendState = ReturnType<typeof createWebgpuBlendState>

/** Reused transparent draw lists and GPU resources for one backend instance. */
export function createWebgpuBlendState() {
  /** Words of the view uniform, allocated once. */
  const view = new Float32Array(BLEND_VIEW_SIZE / 4)
  const blendGpu: BlendGpuItem[] = []
  const visibleBlend: BlendGpuItem[] = []
  const state = {
    blendGpu,
    /** The draws' index by node, made at its first read (`../pages/render/movedNode.ts`). */
    blendIndex: undefined as NodeIndex | undefined,
    visibleBlend,
    /** Normalised frustum planes of the frame, against which an item is rejected. */
    blendPlanes: new Float64Array(FRUSTUM_PLANE_VALUES),
    ...tableState(),
    ...waterState(),
    ...recordState(view),
    ...planState(),
    ...createBlendOrderState(),
    ...planTotals(),
  }
  return state
}

/** The paged transparents' table, its compaction and occlusion, and the groups' identity and
 *  lighting. */
function tableState() {
  return {
    /** The scene's transparent draw order and the GPU compaction that filters it, or undefined
     *  before `prepare` built them — or when the scene carries no paged transparent cluster. */
    table: undefined as TransparentTable | undefined,
    compaction: undefined as TransparentCompaction | undefined,
    ...transparentOcclusionState(),
    /** Table entries changed by the residency journal, awaiting a partial upload. */
    dirtySpans: new Set<number>(),
    /** What the transparent groups currently name: a moved identity voids them. Two are held,
     *  with the groups of each: the shadow maps' tables a lit pass binds are double-buffered, and
     *  their frames take turns. */
    identity: createWebgpuBindIdentity(2),
    /** Lighting resources of the image, resolved once by `encodeBlend`: the blends, the water
     *  surfaces and the water composite bind the same. */
    lighting: undefined as BlendLighting | undefined,
  }
}

/** The water pass and its items, the diagnostic identity and overdraw, and the lobes. */
function waterState() {
  return {
    /** How many transparent items transmit: zero means no backdrop is allocated, and the water pass
     *  does not exist of the scene. */
    transmissive: 0,
    /** A source that brings a transmissive surface asked for the water pass before its items join:
     *  the targets it draws over are made for it (`holdsWater`). */
    waterGranted: false,
    /** A source that brings a blend asked for it before its items join: the front depth the blend
     *  pass writes is made full size (`sceneBlends`). */
    frontGranted: false,
    /** The compaction and the occlusion test being made for the first blended pages the session
     *  gains (`mountTransparent`), until they are. */
    mounting: undefined as Promise<boolean> | undefined,
    /** This image wants water, its head words written (`../water/pass.ts`); its rectangle's
     *  kernels ran (`expansionFrame.ts`); or no water can draw it, and nothing of it is encoded. */
    waterWanted: false,
    waterBound: false,
    waterQuiet: false,
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
    /** An item is `lobed`: the blends are lit by a lobed program (`shader.ts`); a transmissive
     *  one: the water draws through its lobed stage, into a full-size lobes target
     *  (`../water/lobedStage.ts`, `wantsPhysicalLobes`). Both set with the records. */
    lobed: false,
    waterLobed: false,
  }
}

/** The item records and the view uniform (`view`, its words). */
function recordState(view: Float32Array<ArrayBuffer>) {
  return {
    /** Item records and the view uniform: one scene buffer, one frame buffer. */
    itemBuffer: undefined as GPUBuffer | undefined,
    itemPacked: new Float32Array(0) as Float32Array<ArrayBuffer>,
    /** Whole view of the records, on the same buffer: allocated with them, never per frame. */
    itemInts: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    viewBuffer: undefined as GPUBuffer | undefined,
    viewPacked: view,
    viewInts: new Uint32Array(view.buffer),
  }
}
