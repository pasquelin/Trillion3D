import type { Material } from '../../../sdk-core/src/index.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { PlacementRows } from './placementRows.ts';

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
   *  (`placementGrowth.ts`). Absent, the owner opens the session again on `to`. */
  growPlacements?(from: PlacementRows, to: PlacementRows): void;
  /** Bounced light on or off in place, where the engine carries it (`BackendContext.bounce`). */
  setBounce?(on: boolean): void;
  /** Repaints a primitive from the engine's material parameters: no shader, no program hook. */
  updateMaterial?(primitive: string, material: Material): void;
}
