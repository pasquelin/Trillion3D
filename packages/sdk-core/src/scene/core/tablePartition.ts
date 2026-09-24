/**
 * The world partition the scene tables carry (`scene-tables.json`, `partition`;
 * `packages/asset-compiler-rust/src/compiler_tables/partition.rs`): the nodes that only place a
 * mesh are not in the node table the runtime reads before its first frame, but in spatial cells
 * read by distance to the camera — each cell one size class of objects, under one stream unit.
 */
import { EngineError } from '../../contracts/cache.ts';

/** The version of the partition and of its cell files this runtime reads. */
const PARTITION_VERSION = 1;

/** One cell: where it is read, its fingerprint and size, the box around what it holds (scene
 *  frame, `[minX, minY, minZ, maxX, maxY, maxZ]`), the diagonal of its largest object, and how many
 *  nodes of each mesh it places. */
export interface TableCell {
  /** Its file, relative to the tables. */
  url: string;
  /** Fingerprint of its bytes. */
  sha256: string;
  /** Its size in bytes. */
  bytes: number;
  /** The box around every object it places. */
  bounds: readonly number[];
  /** The world-box diagonal of its largest object. */
  size: number;
  /** `[mesh rank, nodes]` per mesh it places: what the runtime sizes its rows by at open. */
  meshes: readonly (readonly [number, number])[];
}

/** The partition of a scene: its cells, the box around them all, and the meshes they place. */
export interface TablePartition {
  /** Version of the partition. */
  version: number;
  /** The box around every cell. */
  bounds: readonly number[];
  /** The mesh ranks the cells place: each is drawn from rows, whatever cell brings it. */
  meshes: readonly number[];
  /** The cells. */
  cells: readonly TableCell[];
}

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

/** The partition, `null` when the scene has none, or a named refusal of another version. */
export function assertTablePartition(value: unknown): TablePartition | null {
  if (value === null || value === undefined) return null;
  const partition = value as TablePartition;
  if (partition.version !== PARTITION_VERSION)
    throw new EngineError(
      'UNSUPPORTED_SCENE_TABLES',
      `scene partition version ${String(partition.version)} is not the ${PARTITION_VERSION} this runtime reads`,
      { partitionVersion: partition.version ?? null },
    );
  if (
    !Array.isArray(partition.cells) ||
    !Array.isArray(partition.meshes) ||
    !partition.cells.every((cell) => Array.isArray(cell?.meshes))
  )
    throw new EngineError('INVALID_SCENE_TABLES', 'scene partition misses its cells', {});
  return partition;
}

/** The nodes of a cell file, or a named refusal. */
export function assertCellNodes(value: unknown): readonly CellNode[] {
  const cell = value as { version?: number; nodes?: CellNode[] } | null;
  if (!cell || cell.version !== PARTITION_VERSION || !Array.isArray(cell.nodes))
    throw new EngineError('INVALID_SCENE_TABLES', 'scene cell is not a version 1 node list', {
      version: cell?.version ?? null,
    });
  return cell.nodes;
}
