import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'

/**
 * Column-major 4×4 matrix owned by HOST — pose of a node in its scene. Engine only reads
 * its sixteen floats: no host structure crosses a signature.
 */
export type MatrixElements = {
  /** The sixteen numbers, column by column. */
  readonly elements: ArrayLike<number>
}

/**
 * The same sixteen floats, WRITABLE term by term: the pose a boundary sets back on a host node
 * or on a host camera it restores. It is the mutable face of `MatrixElements` and lives beside
 * it; nothing asks the host to compose them — `copyMatrix4` writes them as they stand.
 */
export type HostNodeMatrix = {
  /** The sixteen numbers, by index. */
  readonly elements: { [index: number]: number; readonly length: number }
}

/** The identity pose, shared: a root placed at the origin reads it. */
export const IDENTITY_WORLD: MatrixElements = { elements: IDENTITY_MATRIX4 }
