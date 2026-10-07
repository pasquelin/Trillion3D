import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { AlphaMode } from '../../../sdk-core/src/contracts/material.ts'
import type { PlacementRows } from './rows.ts'
import type { HostAttributes, HostMaterials } from '../host/resources.ts'
import type { SelectionUniforms } from '../gpu/core/selection.ts'

/** A range of one vertex list a dynamic geometry rewrote (#573): vertices `from` to
 *  `from + count - 1` of the host geometry's list `name`. */
export type VertexRange = {
  name: 'position' | 'normal' | 'uv' | 'color'
  from: number
  count: number
}

/** How a material's alpha moved (`world/api/materialApi.ts`, #846): the host surfaces written,
 *  and the modes before and after — equal when only a cutout's cutoff moved. */
export type AlphaChange = { surfaces: readonly object[]; from: AlphaMode; to: AlphaMode }

/** A created material given to drawables (`assignMaterial`, #847): each source mesh and the
 *  surface it wears from now on — the material's variant its geometry asks for —, `surfaces`
 *  those variants, `from` a mode one of them leaves whose blended-or-not differs from `to`, if
 *  any does. */
export type SurfaceAssignment = AlphaChange & { meshes: ReadonlyMap<object, object> }

/** Whether a change assigns a surface rather than rewrites one. */
export const isAssignment = (alpha: AlphaChange): alpha is SurfaceAssignment => 'meshes' in alpha

/** A change into or out of blended: the one that moves drawables between draw families. */
export const blendMoves = ({ from, to }: AlphaChange) =>
  from !== to && (from === 'blend' || to === 'blend')

/** Whether a surface's alpha moved from `from` to `to`: another mode, or a cutout whose cutoff
 *  moved — what the shadow of a cutout reads. */
export const alphaMoves = (from: AlphaMode, to: AlphaMode, cutoffMoved: boolean) =>
  to !== from || (to === 'mask' && cutoffMoved)

/** What an owner hands a session that grows its instance buffers in place (`growth.ts`). */
export type PlacementGrowth = {
  /** An instance buffer the session holds was replaced by a larger one, `from`'s rows first and
   *  the rest parked: the session reads `to` from now on and holds its new rows, no table rebuilt
   *  (`growth.ts`). */
  growPlacements(from: PlacementRows, to: PlacementRows): void
  /** Whether `growPlacements` takes each of `from` grown to `capacity` rows, asked before the
   *  owner replaces any: false leaves them as they are, and the owner opens the session again on
   *  larger ones. */
  growsInPlace(from: readonly PlacementRows[], capacity: number): boolean
}

/** What an engine lets a host change in the scene it prepared, without preparing it again. */
export interface EngineSceneUpdates extends PlacementGrowth {
  /** Moves a named node of the prepared scene; applied to the next frame, without allocation (R8). */
  setTransform(nodeName: string, matrix: Float32Array): void
  /** `setTransform` on nodes of the prepared scene the host holds, sixteen floats each, one pass. */
  setTransforms(nodes: readonly Object3D[], matrices: Float32Array): void
  /** Rows `from` to `to` of an instance buffer the session was opened with were written — a pose,
   *  a row taken or parked: the roots that read them follow at the next frame, no table rebuilt. */
  updatePlacements(rows: PlacementRows, from: number, to: number): void
  /** POC: rows `links` follow `parent`, whose world is `world`; the engine composes them on the
   *  GPU. `whole`: they are every row that follows it, none unlinks it; otherwise rows it holds,
   *  at a new local matrix. False when it cannot: the owner writes the rows itself. */
  composePlacements(
    parent: object,
    world: ArrayLike<number>,
    links: readonly { rows: PlacementRows; index: number; local: ArrayLike<number> }[],
    whole: boolean,
  ): boolean
  /** The cut's uniforms while it packs the world DAG (`GpuSelection.packsWorld`), which a
   *  partition's plan projects its far cells with (#1332); `undefined` while none packs it. */
  worldCut(): SelectionUniforms | undefined
  /** The lists `ranges` name of the host geometry whose attributes are `attributes` — a dynamic
   *  geometry's (#573) — were rewritten in place, its moved vertices within `box` (local, where
   *  they were and where they go), each vertex at most `reach` from where its page is bounded on
   *  an axis (`world/page/runtimePrimitive.ts`), each page's vertices within its box of `boxes`
   *  (`world/core/pageMotion.ts`), when given: the engine writes those vertices into the buffers
   *  it holds, grows every cut of their roots by `reach` as a deformation's, bounds each page's
   *  row by its box, and stales what they shadowed, no table rebuilt. True when taken; false, the
   *  owner opens the session again. */
  updateVertices(
    attributes: HostAttributes,
    ranges: readonly VertexRange[],
    box: Float64Array,
    reach: number,
    boxes?: Float64Array,
  ): boolean
  /** The bytes `updateVertices` sends the GPU for `ranges` (#573). */
  vertexBytes(attributes: HostAttributes, ranges: readonly VertexRange[]): number
  /** The clear colour behind the scene, `0xrrggbb` (`EngineContext.clearColor`), read by the
   *  next frame: the held frame broken, nothing else walked. */
  setClearColor(hex: number): void
  /** Bounced light on or off in place (`EngineContext.bounce`). */
  setBounce(on: boolean): void
  /** Temporal antialiasing on or off in place (`EngineContext.temporalAntialiasing`); whether
   *  the image carries it is the `'temporal antialiasing'` capability. */
  setTemporalAntialiasing(on: boolean): void
  /** The render scale asked in place (`EngineContext.renderScale`), drawn from the next frame, and
   *  the scale of the last image drawn. */
  setRenderScale(scale: import('../frame/renderScaleOption.ts').RenderScale): void
  renderScale(): number
  /** The host surfaces the session was opened with had their values rewritten in place, their
   *  version bumped (`world/core/worldSurface.ts`, `repaintHostSurface`): what reads them is read
   *  again at the next frame, no table rebuilt. False for this change — a map whose picture
   *  changed size where its layout is fixed (#362) —, the owner opens the session again.
   *  `values` false when only their textures moved — a picture, a sampling, a placement —: the
   *  frame follows those itself, and nothing a value feeds, a page-table row, is written again.
   *  `alpha` when surfaces changed alpha mode or cutoff, a class change the engine said it takes
   *  (`materialClassRefusal`): their drawables go to the family the open would give them, and
   *  what their cutout shadowed is drawn again. */
  refreshMaterials(values?: boolean, alpha?: AlphaChange): boolean | void
  /** Why the engine cannot move these surfaces from `from` to `to` inside the session, `undefined`
   *  when it can; asked before any write. */
  materialClassRefusal(alpha: AlphaChange): string | undefined
  /** The source meshes of `assignment` wear its surface from now on, one their owner keeps
   *  (#847): their records follow it, before `refreshMaterials(true, assignment)`; a mesh no
   *  page draws was refused before (`materialClassRefusal`). */
  wearSurface(assignment: SurfaceAssignment): void
  /** Admit a runtime surface's maps through the engine's existing texture path. */
  admitMaterial(surface: HostMaterials): Promise<void>
  /** Release an admitted material after its last assignment leaves. */
  releaseMaterial(surface: HostMaterials): void
}
