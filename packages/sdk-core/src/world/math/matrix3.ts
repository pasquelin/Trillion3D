import { normalMatrix3 } from '../../math/matrix/matrix3.ts'
import type { Matrix4 } from './matrix4.ts'

/** A 3×3 matrix, column-major: a normal transform, a texture transform. */
export class Matrix3 {
  /** Always `true`: tells a 3×3 matrix apart. */ readonly isMatrix3 = true as const
  /** The nine numbers, column by column. */
  readonly elements = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])

  // prettier-ignore
  /** Sets the nine numbers, row by row. */
  set(n11: number, n12: number, n13: number, n21: number, n22: number, n23: number,
    n31: number, n32: number, n33: number) {
    const e = this.elements;
    e[0] = n11;
    e[1] = n21;
    e[2] = n31;
    e[3] = n12;
    e[4] = n22;
    e[5] = n32;
    e[6] = n13;
    e[7] = n23;
    e[8] = n33;
    return this;
  }
  /** Resets to the 3×3 identity. */ identity() {
    return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1)
  }
  /** Takes the numbers of another 3×3 matrix. */ copy(m: { elements: ArrayLike<number> }) {
    for (let i = 0; i < 9; i++) this.elements[i] = m.elements[i]
    return this
  }
  /** A new 3×3 matrix with the same numbers. */ clone() {
    return new Matrix3().copy(this)
  }
  /** Keeps the turn and stretch part of a 4×4 matrix. */ setFromMatrix4(m: Matrix4) {
    const e = m.elements
    return this.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10])
  }
  /** Inverse transpose of the upper 3×3: what carries normals under `m`. */
  getNormalMatrix(m: Matrix4) {
    normalMatrix3(this.elements, m.elements)
    return this
  }
  /** The nine numbers as a list. */ toArray(): number[] {
    return Array.from(this.elements)
  }
}
