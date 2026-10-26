import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'

/**
 * A column-major 4×4 pose — a node's world matrix, an instance's placement — as the engine reads
 * it: its sixteen floats, whatever holds them.
 */
export type MatrixElements = {
  /** The sixteen numbers, column by column. */
  readonly elements: ArrayLike<number>
}

/** The identity pose, shared: a root placed at the origin reads it. */
export const IDENTITY_WORLD: MatrixElements = { elements: IDENTITY_MATRIX4 }
