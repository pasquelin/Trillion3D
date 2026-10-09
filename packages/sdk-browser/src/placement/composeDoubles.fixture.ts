// The compose passes' doubles as their tests run them (`shaderRun`, `gpuComposeWgsl.ts`): the
// functions of `math/src/wgsl/double.ts` a run names before its own, a double as the shader holds it, and the
// generated matrices the passes are held to the CPU on.
import { composeMatrix4 } from '../../../sdk-core/src/index.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'

/** A double as the shader holds it: high word, low word. */
export type Pair = number[]

/** The functions of `math/src/wgsl/double.ts` up to `dMul`, which every compose function calls. */
export const DOUBLE_HELPERS = [
  'dNan',
  'dExponent',
  'dIsNan',
  'dIsZero',
  'dSignificand',
  'dScale',
  'wideAdd',
  'wideSub',
  'wideLeadingZeros',
  'wideShiftLeft',
  'wideShiftRight',
  'wideProduct',
  'dRound',
  'dAdd',
  'dSub',
  'dMul',
]

/** The built-in those functions call. */
export const countLeadingZeros = (x: number) => Math.clz32(x)

/** `x` as the shader holds it (`packDoubles`). */
export const pair = (x: number): Pair => {
  const out = new Uint32Array(2)
  packDoubles(out, 0, [x])
  return [...out]
}

/** A generated matrix: a turn, a scale — uneven, negative —, a translation, now and then a shear
 *  (a parent posed by a matrix of its own). */
export function generated(next: () => number, far: number) {
  const out = new Float64Array(16),
    q = [next() - 0.5, next() - 0.5, next() - 0.5, next() - 0.5],
    n = Math.hypot(...q)
  const scale = [0, 1, 2].map(() => (next() < 0.1 ? -1 : 1) * (0.01 + next() * 40))
  if (next() < 0.5) scale.fill(scale[0])
  composeMatrix4(
    out,
    [0, 1, 2].map(() => (next() - 0.5) * far),
    q.map((v) => v / n),
    scale,
  )
  if (next() < 0.2) out[4] += next() - 0.5
  return out
}
