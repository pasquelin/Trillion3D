import { EngineError } from '../../contracts/cache.ts'

/** What the objects of the volume (a fog volume, a heterogeneous volume, a local fog volume) share
 *  of their declaration: the identity placement, the refusal that names the object, the check of
 *  its placement and the comparison of two resolved ones. */

/** The placement an object names none of: sixteen numbers, column-major. */
export const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const

/** A refusal of one object of the volume, by its id. */
export type VolumeRefusal = (id: unknown, message: string) => never

/** The refusal of the objects `noun` names: `code`, and `noun id: message`. */
export const volumeRefusal =
  (code: string, noun: string): VolumeRefusal =>
  (id, message) => {
    throw new EngineError(code, `${noun} ${String(id)}: ${message}`, { id })
  }

/** Refuses a `matrix` that is not sixteen finite numbers, in a list or a typed array. */
export function checkMatrix(refuse: VolumeRefusal, id: string, matrix: readonly number[]) {
  const list = Array.isArray(matrix) || ArrayBuffer.isView(matrix)
  if (!list || matrix.length !== 16 || !Array.prototype.every.call(matrix, Number.isFinite))
    refuse(id, 'matrix expects sixteen finite numbers')
}

/** Whether two resolved objects are the same: their numbers, and the very graph at the version it
 *  was read (the graph is no text a comparison can read). */
export const sameGraphedObject = <T extends { graph?: unknown }>(a: T, b: T) =>
  a.graph === b.graph &&
  JSON.stringify({ ...a, graph: undefined }) === JSON.stringify({ ...b, graph: undefined })
