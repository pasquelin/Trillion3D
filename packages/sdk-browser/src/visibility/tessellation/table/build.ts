import { TABLE_DATA_WORD, TABLE_SIZE } from '../contract.ts'
import { pattern } from './remesh.ts'

/** The tessellation table: `offsets`, two words per pattern — where its words start in `data`, and
 *  its vertex and triangle counts packed `vertices << 13 | triangles << 22` —, and `data`, each
 *  pattern's vertices then its triangles, a pattern at the index its factors give
 *  (`patternIndex`). */
export type TessellationTable = { offsets: Uint32Array; data: Uint32Array }

/** Every ordered triple of factors `x >= y >= z` from 1 to `TABLE_SIZE`, in the table's order. */
function* triples(): Generator<[number, number, number]> {
  for (let z = 1; z <= TABLE_SIZE; z++)
    for (let y = z; y <= TABLE_SIZE; y++) for (let x = y; x <= TABLE_SIZE; x++) yield [x, y, z]
}

/**
 * The tessellation table, built once (the first time a displaced surface is drawn): a pattern for
 * every triple of edge factors up to `TABLE_SIZE`, as the remeshing gives it (`remesh.ts`).
 */
export function buildTessellationTable(): TessellationTable {
  const offsets = new Uint32Array(TABLE_DATA_WORD)
  const data: number[] = []
  for (const [x, y, z] of triples()) {
    const { verts, indexes } = pattern([x, y, z])
    const at = 2 * ((z - 1) * 256 + (y - 1) * 16 + (x - 1))
    offsets[at] = data.length
    offsets[at + 1] = ((verts.length << 13) | (indexes.length << 22)) >>> 0
    data.push(...verts, ...indexes)
  }
  return { offsets, data: Uint32Array.from(data) }
}
