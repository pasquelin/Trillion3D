import type { Material } from '../../../sdk-core/src/index.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { PlacementRows } from './rows.ts';

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
   *  again at the next frame, no table rebuilt. Absent, the owner opens the session again. */
  refreshMaterials?(): void;
  /** Repaints a primitive from the engine's material parameters: no shader, no program hook. */
  updateMaterial?(primitive: string, material: Material): void;
}
