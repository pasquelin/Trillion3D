/**
 * A cell file of the world partition (`scene-cell-*.json`,
 * `packages/asset-compiler-rust/src/compiler/tables/partition.rs`): the nodes it places, each under
 * a core node or the scene root, read by distance to the camera (`tablePartition.ts`).
 */
import { EngineError } from '../../contracts/cache.ts'

/** The version of the cell files this runtime reads: 3 names an instanced skinned object's track
 *  (`track`) and the core node an animated object's row is drawn from (`source`). */
const CELL_VERSION = 3

/** One node a cell places: the core node it hangs under (`null`, the scene), its mesh, and its
 *  LOCAL pose exactly as declared — a matrix, or translation, rotation and scale, each `null` or
 *  left out when silent — which the runtime composes the way it composes every other pose. An
 *  instanced skinned object hangs under its skin's frame at no pose and names the track of the
 *  scene's animation banks it plays (`track`); an animated object of the core — skinned, morphed or
 *  moved by a clip — is drawn by a row under its own node at no pose, that node's host mesh its
 *  animation source (`source`). */
export interface CellNode {
  /** Rank of its parent in the core node table; `null` for a scene root. */
  parent: number | null
  /** The mesh it places. */
  mesh: number
  /** Its local matrix, column-major. */
  matrix?: readonly number[] | null
  /** Where it stands. */
  translation?: readonly number[] | null
  /** How it is turned, as a quaternion. */
  rotation?: readonly number[] | null
  /** How it is stretched. */
  scale?: readonly number[] | null
  /** The item of the scene's animation banks the row plays (`./animationBanks.ts`). */
  track?: number
  /** The row is drawn from its parent's own host mesh: its skeleton and morph weights move it. */
  source?: true
}

/** The nodes of a cell file, read from `url`, or a named refusal. */
export function assertCellNodes(value: unknown, url = 'scene cell'): readonly CellNode[] {
  const cell = value as { version?: number; nodes?: CellNode[] } | null
  if (!cell || cell.version !== CELL_VERSION || !Array.isArray(cell.nodes))
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      `${url} is not a version ${CELL_VERSION} node list`,
      { version: cell?.version ?? null },
    )
  return cell.nodes
}
