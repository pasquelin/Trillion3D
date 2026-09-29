/**
 * A cell file of the world partition (`scene-cell-*.json`,
 * `packages/asset-compiler-rust/src/compiler_tables/partition.rs`): the nodes it places, each under
 * a core node or the scene root, read by distance to the camera (`tablePartition.ts`).
 */
import { EngineError } from '../../contracts/cache.ts';

/** The version of the cell files this runtime reads. */
const CELL_VERSION = 2;

/** One node a cell places: the core node it hangs under (`null`, the scene), its mesh, and its
 *  LOCAL pose exactly as declared — a matrix, or translation, rotation and scale, each `null`
 *  when silent — which the runtime composes the way it composes every other pose. */
export interface CellNode {
  /** Rank of its parent in the core node table; `null` for a scene root. */
  parent: number | null;
  /** The mesh it places. */
  mesh: number;
  /** Its local matrix, column-major. */
  matrix: readonly number[] | null;
  /** Where it stands. */
  translation: readonly number[] | null;
  /** How it is turned, as a quaternion. */
  rotation: readonly number[] | null;
  /** How it is stretched. */
  scale: readonly number[] | null;
}

/** The nodes of a cell file, or a named refusal. */
export function assertCellNodes(value: unknown): readonly CellNode[] {
  const cell = value as { version?: number; nodes?: CellNode[] } | null;
  if (!cell || cell.version !== CELL_VERSION || !Array.isArray(cell.nodes))
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      `scene cell is not a version ${CELL_VERSION} node list`,
      {
        version: cell?.version ?? null,
      },
    );
  return cell.nodes;
}
