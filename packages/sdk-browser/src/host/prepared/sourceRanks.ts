import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** Cache node identity is independent of names, draw order and host object allocation. */
const ranks = new WeakMap<Object3D, number>();
export const preparedNodeRank = (node: Object3D) => ranks.get(node);
export const registerPreparedNodeRank = (node: Object3D, rank: number) => ranks.set(node, rank);
/** The mesh rank a partition's placed host mesh draws its cells' nodes of (#966): a cell node has
 *  no host node of its own, and casts as that mesh says. */
const placedRanks = new WeakMap<Object3D, number>();
export const placedMeshRank = (node: Object3D) => placedRanks.get(node);
export const registerPlacedMeshRank = (node: Object3D, rank: number) =>
  placedRanks.set(node, rank);

/** Fixed-width source ranks keep the core node table's byte size independent of world size. */
export function readPreparedSourceRank(value: unknown, tableRank: number): number {
  if (value === undefined) return tableRank;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}$/.test(value))
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      'sourceNode must be eight lowercase hexadecimal digits',
    );
  return Number.parseInt(value, 16);
}
