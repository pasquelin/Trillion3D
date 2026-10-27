// The stand-ins `shaderRun` lacks, for the page decode's shader tests (`pointHeader.test.ts`,
// `visOpaque.test.ts`, `pageHeaderReference.test.ts`): WGSL's 3×3 and the integer division the page
// decode leans on (`homesDecode.test.ts`).
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { F32_SCOPE } from '../../lighting/shaderRunF32.fixture.ts'

export type V = number[]
export type Fn = (...args: unknown[]) => unknown

/** WGSL's 3×3 by its columns, multiplied in binary32. */
export class Mat3 {
  [column: number]: V
  constructor(columns: V[]) {
    columns.forEach((column, i) => (this[i] = [...column]))
  }
}
const mat3x3f = (...columns: V[]) => new Mat3(columns)
export const STRUCTS = {
  mat3x3f,
  determinant: (m: Mat3) => F32_SCOPE.dot(m[0], F32_SCOPE.cross(m[1], m[2])),
  // A scene's row holds its surface's record itself in its material word.
  materialAt: (record: unknown) => record,
  bitcast_vec4u: builtins.bitcast_vec3u,
  i32: (x: number) => x | 0,
}
/** WGSL integers where the page decode leans on them: division truncates, `>>` of an `i32` keeps
 *  its sign (`homesDecode.test.ts`). */
export const integer$b = (op: string, a: number, b: number) =>
  typeof a !== 'number' || typeof b !== 'number'
    ? builtins.$b(op, a, b)
    : op === '/'
      ? Math.trunc(a / b)
      : op === '>>' && a < 0
        ? a >> b
        : builtins.$b(op, a, b)
