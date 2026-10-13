// The WGSL matrices `shaderRun` (`shaderRun.fixture.ts`) runs a shader with, and their products
// with a vector, in JavaScript double precision.

/** A column-major 4×4 matrix. */
export class Mat {
  readonly m: readonly number[]
  readonly [column: number]: readonly number[]
  constructor(m: readonly number[]) {
    this.m = m
    for (let column = 0; column < 4; column++)
      Object.defineProperty(this, column, { value: m.slice(column * 4, column * 4 + 4) })
  }
}

/** A column-major 3×3 matrix, from its three columns (`mat3x3f`), each read by its index. */
export class Mat3 {
  readonly columns: readonly number[][]
  readonly [column: number]: readonly number[]
  constructor(columns: number[][]) {
    this.columns = columns
    for (let column = 0; column < 3; column++)
      Object.defineProperty(this, column, { value: columns[column] })
  }
}

/** `a * b` where one side is a matrix: a matrix times a column vector, or a row vector times a
 *  3×3 matrix (the dot of the vector with each column); undefined when neither side is one. */
export function matrixProduct(a: unknown, b: unknown): number[] | undefined {
  if (a instanceof Mat3) {
    const v = b as number[]
    return [0, 1, 2].map((row) =>
      a.columns.reduce((sum, column, col) => sum + column[row] * v[col], 0),
    )
  }
  if (a instanceof Mat) {
    const v = b as number[]
    return [0, 1, 2, 3].map((row) => v.reduce((sum, x, col) => sum + a.m[col * 4 + row] * x, 0))
  }
  if (b instanceof Mat3) {
    const v = a as number[]
    return b.columns.map((column) => column.reduce((sum, x, row) => sum + x * v[row], 0))
  }
  return undefined
}
