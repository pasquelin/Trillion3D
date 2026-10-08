// What a test of a shader rewrite runs both texts with (`shaderRun`, in doubles) and compares
// them by: seeded f32 inputs with their edges — signed zeros, ones, the f32 limits, infinities,
// NaN —, the bit-for-bit equality of two results, and the built-ins of the VSM helpers that
// `shaderRunBuiltins.fixture.ts` lacks.
import { Mat } from '../texture/shaderRun.fixture.ts'
import { builtins, each } from '../texture/shaderRunBuiltins.fixture.ts'
import { unit } from './pageWorld.fixture.ts'
import { seeded } from './planFrames.fixture.ts'
import { floorLog2 } from '../../../math/src/scalar/integers.ts'
import { FLOAT32_MAX } from '../../../math/src/constants.ts'

const F32_MIN_NORMAL = 1.1754943508222875e-38
/** The values an input takes now and then. */
const EDGES = [0, -0, 1, -1, 0.5, -0.5, 2, -2, FLOAT32_MAX, -FLOAT32_MAX, F32_MIN_NORMAL]
/** The values an input takes now and then where the shader meets them: infinities and NaN. */
const NON_FINITE = [Infinity, -Infinity, NaN]

/** Seeded inputs: f32 values of either sign over `span` binary orders around 1, an edge (and a
 *  non-finite value when `nonFinite`) one draw in `edge`. */
export function inputs(seed: number, { edge = 8, span = 16, nonFinite = true } = {}) {
  const random = seeded(seed)
  const edges = nonFinite ? [...EDGES, ...NON_FINITE] : EDGES
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
  const f = () =>
    random() * edge < 1
      ? pick(edges)
      : Math.fround((random() < 0.5 ? -1 : 1) * 2 ** ((random() - 0.5) * span))
  return {
    random,
    pick,
    f,
    vec: (size: number, value = f) => Array.from({ length: size }, value),
    mat: (value = f) => new Mat(Array.from({ length: 16 }, value)),
    /** An integer of [lo, hi]. */
    int: (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1)),
    bool: () => random() < 0.5,
  }
}

/** Whether two results are the same bits: numbers by `Object.is` (NaN is NaN, −0 is not 0),
 *  vectors, matrices and structures member by member (`keys`, else all of `a`'s). */
export function sameBits(a: unknown, b: unknown, keys?: readonly string[]): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b)
  if (a instanceof Mat && b instanceof Mat) return sameBits(a.m, b.m)
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameBits(x, b[i]))
    )
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>,
      y = b as Record<string, unknown>
    return (keys ?? Object.keys(x)).every((key) => key in y && sameBits(x[key], y[key]))
  }
  return a === b
}

/** The built-ins of the VSM helpers that `shaderRun` lacks: a signed `firstLeadingBit`,
 *  `inverseSqrt`, `mat4x4f`, a matrix times a matrix (column by column, as `shaderRun` multiplies
 *  a vector), `arrayLength` and the `array<T,N>(…)` lists of `withArrays`. */
export const MORE_BUILTINS = {
  firstLeadingBit: each((x) => floorLog2(Number(x) < 0 ? ~Number(x) : Number(x))),
  countLeadingZeros: each((x) => Math.clz32(Number(x))),
  inverseSqrt: each((x) => 1 / Math.sqrt(Number(x))),
  mat4x4f: (...columns: number[][]) => new Mat(columns.flat()),
  $b: (op: string, a: unknown, b: unknown) =>
    a instanceof Mat && b instanceof Mat
      ? new Mat([0, 1, 2, 3].flatMap((c) => builtins.$b(op, a, b[c] as number[]) as number[]))
      : builtins.$b(op, a as number, b as number),
  arrayLength: (p: { get: () => unknown[] }) => p.get().length,
  arrayOf: (...items: unknown[]) => items,
}

/** A WGSL text whose `array<T,N>(…)` lists run as JavaScript arrays (`arrayOf`). */
export const withArrays = (source: string) =>
  source.replace(/array<\s*\w+\s*,\s*\d+\s*>\(/g, 'arrayOf(')

/** A 32-bit word of a list of integers (`pageWorld.fixture.ts`'s hash), to stand in for a table's
 *  word at an address. */
export const hashWord = (...words: number[]) => unit(...words) * 2 ** 32
