import { transparentOcclusionState } from './transparent/entryCorners.ts'
import { createChangedRuns } from '../geometry/residency/ranges.ts'
import type { DrawSource } from '../geometry/selection/drawSource.ts'
import type { PageSurface } from '../geometry/pages/surface.ts'
import type { MatrixElements } from '../session/host/matrixElements.ts'
import type { PlacementOf } from '../placement/rows/rows.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../math/src/geometry/frustum/frustum.ts'
import type { DiagnosticMode } from '../../../sdk-core/src/runtime/diagnostics.ts'
import { readSetting } from '../../../sdk-core/src/contracts/settingRules.ts'
import {
  SKY_QUALITY_RULES,
  type SkyQualityOptions,
} from '../../../sdk-core/src/modules/sky/quality.ts'
import type { BlendViewGroups } from './identity.ts'
import type { BlendLighting } from '../gpu/bind/blendBindEntries.ts'
import type { BlendOverdraw } from './overdraw.ts'
import type { TransparentCompaction } from './transparent/compact.ts'
import type { TransparentTable } from './transparent/table.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { createBlendOrderState } from './order/orderState.ts'
import { planState, planTotals } from './plan/planState.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import type { GeometryBlock } from '../geometry/rows/page/pageRowMaterial.ts'
import type { NodeIndex } from '../frame/render/movedNode.ts'
import type { WaterTargets } from './water/waterTargets.ts'
import type { FrontOutputs } from '../lighting/reflections/frontLayer.ts'

/** A transparent item: one blended root's placement, drawn from its pages cluster by cluster, as
 *  the opaque rows draw theirs — it owns no buffer. */
export type BlendGpuItem = {
  /** The material transmits: its layer is lit and composed as a thin translucent layer, and it
   *  distorts what lies behind it (`./transmission/transmitWgsl.ts`). */
  transmissive?: boolean
  /** The material is single-layer water: drawn by the water pass, over the scene without it (`./water/`). */
  water?: boolean
  /** Its surface carries an anisotropic or clear-coat lobe, set with its record
   *  (`refreshBlendScene`): what every lobe switch of the transparent passes is derived from. */
  lobed?: boolean
  surface: PageSurface
  /** Its translucent sort priority: its source node's `renderOrder`, clamped to a signed 16-bit value,
   *  what the sort key stores (`PRIORITY_BIAS`). The lower paints first, whatever its distance (`paintOrder.ts`). */
  priority: number
  matrix: MatrixElements
  /** The row posing the item when its mesh is placed by rows: skipped while it is parked. */
  placement?: PlacementOf
  /** True while the host hides the source mesh or one of its ancestors: skipped as a parked
   *  row's item is (`placement/hidden.ts`). */
  hidden?: boolean
  drawSource?: DrawSource
  sourceGeometry: Geometry
  /** Its local box, six bounds flat: what its pages lie in (`BlendCopy.localBox`), read
   *  in place of its geometry's box (`readItemBox`). */
  pageBox?: Float64Array
  /** World box of the item, six bounds flat (`packages/math/src/geometry/box.ts`); absent, the item is not rejected. */
  bounds?: Float64Array
  /** Buffer this box occupies, allocated once for the item when the frustum can reject it.
   *  Absent, the item never has a box; present, `bounds` points at it or is `undefined` because
   *  the bounds obtained were not usable (`worlds.ts`). */
  worldBox?: Float64Array
  /** What its geometry brings to its flags, as a page row's block does (`rowFlags`, written with
   *  its record, `items.ts`): normals, tangents (none read from pages), colours, UVs, quantized. */
  geometry: GeometryBlock
  /** The flags the item alone decides — transmissive — in the low sixteen bits; its surface's and
   *  geometry's join them in its record (`items.ts`). */
  flags: number
  /** Rank of the item in the transparent table: the base its instances are written at. */
  pagedIndex?: number
  /** Base of its cluster list in the transparent table, zero before it joins it. */
  tableBase?: number
  /** Plan entries the statics reserved for it (`buildBlendStatics`): one, or two when its surface asked two passes. */
  sides?: number
  /** First vertex of its geometry in the float pool, zero for one drawn from quantized pages. */
  vertexBase?: number
}

/** The blend state a session holds (`createWebgpuBlendState`). */
export type WebgpuBlendState = ReturnType<typeof createWebgpuBlendState>

/** Reused transparent draw lists and GPU resources for one backend instance. `context`: the session's
 *  settings, of which the project switch `cloudShadowOnTranslucent` is read once when it opens, as
 *  the clip plane's is (`cloudVertex.ts`). */
export function createWebgpuBlendState(context: SkyQualityOptions = {}) {
  /** Words of the view uniform, allocated once. */
  const view = new Float32Array(BLEND_VIEW_SIZE / 4)
  const blendGpu: BlendGpuItem[] = []
  const visibleBlend: BlendGpuItem[] = []
  const state = {
    /** Whether the translucent programs read the clouds' shade at each vertex. */
    cloudShade: readSetting(SKY_QUALITY_RULES, context, 'cloudShadowOnTranslucent'),
    blendGpu,
    /** The draws' index by node, its slots made at its first read (`../frame/render/movedNode.ts`). */
    blendIndex: { revision: 0 } as NodeIndex,
    visibleBlend,
    /** Normalised frustum planes of the frame, against which an item is rejected. */
    blendPlanes: new Float64Array(FRUSTUM_PLANE_VALUES),
    /** The image (`run.frame`) the transparents were last prepared for (`prepareBlend`), -1 before the first. */
    preparedFrame: -1,
    ...tableState(),
    ...translucentState(),
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
    dirtySpans: createChangedRuns(),
    /** The transparent groups of each view, by `viewKey`: the main image, a face of the sky meshes' capture and a planar view keep
     *  their own, so one view's resources never void another's (`blendGroupsOf`). */
    viewGroups: new WeakMap<object, BlendViewGroups>(),
    /** Lighting resources of the image, resolved once by `encodeBlend`: every translucent layer
     *  binds the same. */
    lighting: undefined as BlendLighting | undefined,
  }
}

/** The transmissive items, the diagnostic identity and overdraw, and the lobes. */
function translucentState() {
  return {
    /** How many transparent items transmit: zero means the blend programs hold no transmissive
     *  stage. */
    transmissive: 0,
    /** A source that brings a refracting surface waits for the distortion's targets before its
     *  items join: they are made for it (`holdsRefraction`). */
    refractGranted: false,
    /** A source that brings a blend asked for it before its items join: the front depth the blend
     *  pass writes is made full size (`sceneBlends`). */
    frontGranted: false,
    /** The compaction and the occlusion test being made for the first blended pages the session
     *  gains (`mountTransparent`), until they are. */
    mounting: undefined as Promise<boolean> | undefined,
    /** Per-catalogue-entry cluster identity, and the mode it was written for. */
    clusterIdentity: new Uint32Array(0) as Uint32Array<ArrayBuffer>,
    diagnosticMode: undefined as DiagnosticMode | undefined,
    /** Overdraw counter, mounted by the only diagnostic variant that asks for it. */
    overdraw: undefined as BlendOverdraw | undefined,
    /** An item is `lobed`: the blends are lit by a lobed program (`shader.ts`). Set with the
     *  records. */
    lobed: false,
    /** An item's surface carries a responsiveness (`ITEM_NEEDS.responsive`): under a temporal
     *  pass, the blends write it (`blendResponsiveTargets`). Set with the records. */
    responsive: false,
    /** An item's object is in a lighting channel set other than the default's (`ITEM_NEEDS.channelled`): the
     *  translucent lights hold the test of the channels (`ContractKey.channelless`). Set with the records. */
    channelled: false,
    /** The passes of the image the items' surfaces are drawn in, as a set of `translucencyPassBit`s:
     *  what the frame splits its layers by (`splitsTranslucency`). Set with the records. */
    translucencyPasses: 0,
    /** The items whose surface is a sky material (`MATERIAL_FLAG.sky`): drawn by the sky pass alone (`encodeSkyPass.ts`) and by the
     *  sky meshes' capture, in no layer. Set with the records, so a change of a surface's sky flag is the revision of the list. */
    skyItems: [] as BlendGpuItem[],
    /** The rank in `blendGpu` of each of `skyItems`, in the same order: the bit of the frame's cut words the view's cut sets (`cutSkyItems`). */
    skyRanks: [] as number[],
    /** How many of `skyItems` the view being prepared leaves out (`cutSkyItems`); its sky view opens while some stay. */
    skyCut: 0,
    /** What the front pass writes (`frontStageOf`): the reflecting surface the trace answers once an
     *  item reflects (lit, of the physical model), its lobes once one carries a lobe. Set with the
     *  records. */
    frontOutputs: 0 as FrontOutputs,
    /** Whether an item is lit by the sampled lighting of the nearest translucent layer (`blendFrontLit`): any lit, non-medium model. Set with the records. */
    frontLit: false,
    /** The single-layer water pass's targets, made at the first image that draws it
     *  (`./water/waterTargets.ts`). */
    waterTargets: undefined as WaterTargets | undefined,
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
    /** A blended placement's row turned to draw as another HLOD level — its cell's HLOD 0 actor or
     *  back (`RowCell.proxy`) —: its items' records follow at the next image (`ITEM_HLOD`). */
    proxiesMoved: false,
    viewBuffer: undefined as GPUBuffer | undefined,
    /** The view's `reduced` words as the image's passes set them: (1, 1), then this image's ratio (`selectReduced`). */
    reducedBuffer: undefined as GPUBuffer | undefined,
    viewPacked: view,
    viewInts: new Uint32Array(view.buffer),
  }
}
