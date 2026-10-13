import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'

/** Fixed-width source ranks keep the core node table's byte size independent of world size. */
export function readPreparedSourceRank(value: unknown, tableRank: number): number {
  if (value === undefined) return tableRank
  if (typeof value !== 'string' || !/^[0-9a-f]{8}$/.test(value))
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      'sourceNode must be eight lowercase hexadecimal digits',
    )
  return Number.parseInt(value, 16)
}
