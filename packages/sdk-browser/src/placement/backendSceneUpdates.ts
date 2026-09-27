import type { Material } from '../../../sdk-core/src/index.ts';
import type { AlphaMode } from '../../../sdk-core/src/contracts/material.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { PlacementRows } from './rows.ts';

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

/** What an engine lets a host change in the scene it prepared, without preparing it again. */
export interface BackendSceneUpdates {
  replaceGeometryPage?(url: string, data: DecodedGeometryPage): void;
  /** Prepared-scene instance placed by sixteen column-major floats the engine copies. */
  addInstance?(id: string, transform: Float64Array): void;
  updateInstance?(id: string, transform: Float64Array): void;
  removeInstance?(id: string): void;
  /** Rows `from` to `to` of an instance buffer the session was opened with were written — a pose,
   *  a row taken or parked: the roots that read them follow at the next frame, no table rebuilt. */
  updatePlacements?(rows: PlacementRows, from: number, to: number): void;
  /** An instance buffer the session holds was replaced by a larger one, `from`'s rows first and
   *  the rest parked: the session reads `to` from now on and holds its new rows, no table rebuilt
   *  (`growth.ts`). Absent, the owner opens the session again on `to`. */
  growPlacements?(from: PlacementRows, to: PlacementRows): void;
  /** The clear colour behind the scene, `0xrrggbb` (`BackendContext.clearColor`), read by the
   *  next frame: the held frame broken, nothing else walked. Absent, the owner opens the session
   *  again, after the frame. */
  setClearColor?(hex: number): void;
  /** Bounced light on or off in place, where the engine carries it (`BackendContext.bounce`). */
  setBounce?(on: boolean): void;
  /** Temporal antialiasing on or off in place (`BackendContext.temporalAntialiasing`); whether
   *  the image carries it is the `'temporal antialiasing'` capability. Absent, the engine has none. */
  setTemporalAntialiasing?(on: boolean): void;
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
   *  (#847): their records follow it, before `refreshMaterials(true, assignment)`. False when no
   *  record of theirs takes it in place; absent, only a new session will. */
  wearSurface?(assignment: SurfaceAssignment): boolean;
  /** Repaints a primitive from the engine's material parameters: no shader, no program hook. */
  updateMaterial?(primitive: string, material: Material): void;
}
