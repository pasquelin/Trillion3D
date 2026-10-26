import { EngineError } from '../../../../../sdk-core/src/contracts/cache.ts'
import { parseSourceRank } from '../../../../../sdk-core/src/scene/core/sourceRank.ts'

/** Fixed-width source ranks keep the core node table's byte size independent of world size. A
 *  node that names none is at its table rank — never in a partitioned table (`partitioned`), which
 *  renumbers its nodes: there its rank would name another source node. */
export function readPreparedSourceRank(
  value: unknown,
  tableRank: number,
  partitioned = false,
): number {
  if (value === undefined && partitioned)
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      'a node of a partitioned table names no sourceNode',
      { node: tableRank },
    )
  if (value === undefined) return tableRank
  const rank = parseSourceRank(value)
  if (rank === undefined)
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      'sourceNode must be eight lowercase hexadecimal digits',
    )
  return rank
}
