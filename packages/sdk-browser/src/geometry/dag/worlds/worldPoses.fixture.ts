// A placement's record in the worlds' table (`worldTable.ts`) as the tests that run a shader in
// JavaScript (`materials/texture/shaderRun.fixture.ts`) read it: a pose of sixteen floats a table.
import { WORLD_TABLE } from './worldTable.ts'

/** A double's two words, high then low, as the roots' world boxes keep them. */
export const doubleWords = (value: number) => {
  const words = new Uint32Array(new Float64Array([value]).buffer)
  return [words[1], words[0]]
}

/** Texel `x` of placement 0's record in `table`, a `{ pose }` of sixteen floats, each field in its
 *  own block of a row (`WORLD_TABLE`): a matrix column's single-precision words, the exact
 *  translation's double words (x and y, then z), its instance. */
export const poseTexel = (table: unknown, x: number) => {
  const m = (table as { pose: number[] }).pose
  const origin = 1024 * WORLD_TABLE.fields.Matrix
  if (x < 4) return [...new Uint32Array(new Float32Array(m.slice(4 * x, 4 * x + 4)).buffer)]
  if (x === origin) return [...doubleWords(m[12]), ...doubleWords(m[13])]
  if (x === origin + 1) return [...doubleWords(m[14]), 0, 0]
  return [0, 0, 0, 0]
}
