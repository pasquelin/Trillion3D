import type { Material, Primitive } from '../../../sdk-core/src/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { AlphaMode } from '../../../sdk-core/src/contracts/material.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { PlacementRows } from './rows.ts';
import type { HostAttributes } from '../host/resources.ts';

/** A range of one vertex list a dynamic geometry rewrote (#573): vertices `from` to
 *  `from + count - 1` of the host geometry's list `name`. */
export type VertexRange = {
  name: 'position' | 'normal' | 'uv' | 'color';
  from: number;
  count: number;
};

/** How a material's alpha moved (`world/api/materialApi.ts`, #846): the host surfaces written,
 *  and the modes before and after — equal when only a cutout's cutoff moved. */
export type AlphaChange = { surfaces: readonly object[]; from: AlphaMode; to: AlphaMode };

/** A created material given to drawables (`assignMaterial`, #847): each source mesh and the
 *  surface it wears from now on — the material's variant its geometry asks for —, `surfaces`
 *  those variants, `from` a mode one of them leaves whose blended-or-not differs from `to`, if
 *  any does. */
export type SurfaceAssignment = AlphaChange & { meshes: ReadonlyMap<object, object> };

/** Whether a change assigns a surface rather than rewrites one. */
export const isAssignment = (alpha: AlphaChange): alpha is SurfaceAssignment => 'meshes' in alpha;

/** A change into or out of blended: the one that moves drawables between draw families. */
export const blendMoves = ({ from, to }: AlphaChange) =>
  from !== to && (from === 'blend' || to === 'blend');

/** Whether a surface's alpha moved from `from` to `to`: another mode, or a cutout whose cutoff
 *  moved — what the shadow of a cutout reads. */
export const alphaMoves = (from: AlphaMode, to: AlphaMode, cutoffMoved: boolean) =>
  to !== from || (to === 'mask' && cutoffMoved);

/** A resource placed by rows, as an open reads it: the host mesh that draws it, its association —
 *  its primitive's mesh rank and its rows — and that primitive, as the manifest lists it. */
export type PlacementMount = {
  node: Object3D;
  association: { meshes: number; primitives: number; placements: PlacementRows };
  primitive: Primitive;
};

/** What an owner hands a session that grows its instance buffers in place (`growth.ts`). */
export type PlacementGrowth = {
  /** An instance buffer the session holds was replaced by a larger one, `from`'s rows first and
   *  the rest parked: the session reads `to` from now on and holds its new rows, no table rebuilt
   *  (`growth.ts`). Absent from an engine, the owner opens the session again on `to`. */
  growPlacements(from: PlacementRows, to: PlacementRows): void;
  /** Whether `growPlacements` takes each of `from` grown to `capacity` rows, asked before the
   *  owner replaces any: false leaves them as they are, and the owner opens the session again on
   *  larger ones. */
  growsInPlace(from: readonly PlacementRows[], capacity: number): boolean;
};

/** Whether `updates` takes that growth (`PlacementGrowth.growsInPlace`): absent, every one. */
export const growsInPlaceOf = (
  updates: BackendSceneUpdates,
  from: readonly PlacementRows[],
  capacity: number,
) => updates.growsInPlace?.(from, capacity) ?? true;

/** What an engine lets a host change in the scene it prepared, without preparing it again. */
export interface BackendSceneUpdates extends Partial<PlacementGrowth> {
  /** Moves a named node of the prepared scene; applied to the next frame, without allocation (R8). */
  setTransform?(nodeName: string, matrix: Float32Array): void;
  /** `setTransform` on nodes of the prepared scene the host holds, sixteen floats each, one pass. */
  setTransforms?(nodes: readonly Object3D[], matrices: Float32Array): void;
  replaceGeometryPage?(url: string, data: DecodedGeometryPage): void;
  /** Prepared-scene instance placed by sixteen column-major floats the engine copies. */
  addInstance?(id: string, transform: Float64Array): void;
  updateInstance?(id: string, transform: Float64Array): void;
  removeInstance?(id: string): void;
  /** Rows `from` to `to` of an instance buffer the session was opened with were written — a pose,
   *  a row taken or parked: the roots that read them follow at the next frame, no table rebuilt. */
  updatePlacements?(rows: PlacementRows, from: number, to: number): void;
  /** A resource the session was not opened with enters it (#572): its pages join the same cache,
   *  its roots the same tables. Settles once its root cover is resident; absent, the owner opens
   *  the session again. */
  mountPlacements?(mount: PlacementMount): Promise<void>;
  /** The lists `ranges` name of the host geometry whose attributes are `attributes` — a dynamic
   *  geometry's (#573) — were rewritten in place, its moved vertices within `box` (local, where
   *  they were and where they go): the engine writes those vertices into the buffers it holds and
   *  stales what they shadowed, no table rebuilt. True when taken; absent, the owner opens the
   *  session again. */
  updateVertices?(
    attributes: HostAttributes,
    ranges: readonly VertexRange[],
    box: Float64Array,
  ): boolean;
  /** The bytes `updateVertices` sends the GPU for `ranges`; absent, the lists' own (#573). */
  vertexBytes?(attributes: HostAttributes, ranges: readonly VertexRange[]): number;
  /** The resource `rows` place leaves the session: its roots, pages and copies. */
  unmountPlacements?(rows: PlacementRows): void;
  /** The clear colour behind the scene, `0xrrggbb` (`BackendContext.clearColor`), read by the
   *  next frame: the held frame broken, nothing else walked. Absent, the owner opens the session
   *  again, after the frame. */
  setClearColor?(hex: number): void;
  /** Bounced light on or off in place, where the engine carries it (`BackendContext.bounce`). */
  setBounce?(on: boolean): void;
  /** Temporal antialiasing on or off in place (`BackendContext.temporalAntialiasing`); whether
   *  the image carries it is the `'temporal antialiasing'` capability. Absent, the engine has none. */
  setTemporalAntialiasing?(on: boolean): void;
  /** The render scale asked in place (`BackendContext.renderScale`), drawn from the next frame, and
   *  the scale of the last image drawn. Absent, the engine draws at the display's size. */
  setRenderScale?(scale: import('../frame/renderScaleOption.ts').RenderScale): void;
  renderScale?(): number;
  /** The control behind both where the host composer draws the image (WebGL2): it draws at the
   *  scale it picks and resamples to the display (`../world/render/renderScale.ts`). */
  readonly renderScaleControl?: import('../frame/scaleControl.ts').ScaleControl;
  /** The host surfaces the session was opened with had their values rewritten in place, their
   *  version bumped (`world/core/worldSurface.ts`, `repaintHostSurface`): what reads them is read
   *  again at the next frame, no table rebuilt. Absent, or false for this change — a map whose
   *  picture changed size where its layout is fixed (#362) —, the owner opens the session again.
   *  `values` false when only their textures moved — a picture, a sampling, a placement —: the
   *  frame follows those itself, and nothing a value feeds, a page-table row, is written again.
   *  `alpha` when surfaces changed alpha mode or cutoff, a class change the engine said it takes
   *  (`materialClassRefusal`): their drawables go to the family the open would give them, and
   *  what their cutout shadowed is drawn again. */
  refreshMaterials?(values?: boolean, alpha?: AlphaChange): boolean | void;
  /** Why the engine cannot move these surfaces from `from` to `to` inside the session, `undefined`
   *  when it can; asked before any write. Absent, it moves every one (`alpha`). */
  materialClassRefusal?(alpha: AlphaChange): string | undefined;
  /** The source meshes of `assignment` wear its surface from now on, one their owner keeps
   *  (#847): their records follow it, before `refreshMaterials(true, assignment)`; a mesh no
   *  page draws was refused before (`materialClassRefusal`). Absent, only a new session will. */
  wearSurface?(assignment: SurfaceAssignment): void;
  /** Repaints a primitive from the engine's material parameters: no shader, no program hook. */
  updateMaterial?(primitive: string, material: Material): void;
}
