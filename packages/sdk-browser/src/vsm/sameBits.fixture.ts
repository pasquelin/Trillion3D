// What a test of a shipped shader text runs it with (`shaderRun`, in doubles) and holds it by:
// seeded f32 inputs with their edges — signed zeros, ones, the f32 limits, infinities, NaN —, a
// digest of every bit of its results for a golden, and the built-ins of the VSM helpers that
// `shaderRunBuiltins.fixture.ts` lacks.
import { createHash } from 'node:crypto'
import { mulberry32 } from '../../../math/src/sequence/random.ts'
import { Mat } from '../texture/shaderRunMatrix.fixture.ts'
import { builtins, each } from '../texture/shaderRunBuiltins.fixture.ts'
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
  const random = mulberry32(seed)
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

/** A digest of results, bit for bit: numbers by their exact shortest form (−0 and NaN apart),
 *  vectors, matrices and structures member by member (`keys`, else all of the value's own), so
 *  that a golden holds every bit a run gave. */
export function bitsDigest() {
  const hash = createHash('sha256')
  const add = (value: unknown, keys?: readonly string[]): void => {
    if (typeof value === 'number') hash.update(Object.is(value, -0) ? '-0;' : `${value};`)
    else if (value instanceof Mat) add(value.m)
    else if (Array.isArray(value)) {
      hash.update('[')
      for (const item of value) add(item)
      hash.update(']')
    } else if (value && typeof value === 'object') {
      hash.update('{')
      for (const key of keys ?? Object.keys(value)) {
        hash.update(`${key}:`)
        add((value as Record<string, unknown>)[key])
      }
      hash.update('}')
    } else hash.update(`${String(value)};`)
  }
  return { add, hex: () => hash.digest('hex') }
}

/** The built-ins of the VSM helpers that `shaderRun` lacks: a signed `firstLeadingBit`,
 *  `inverseSqrt`, `mat4x4f`, a matrix times a matrix (column by column, as `shaderRun` multiplies
 *  a vector), `arrayLength` and the `array<T,N>(…)` lists of `withArrays`. */
export const MORE_BUILTINS = {
  firstLeadingBit: each((x) => floorLog2(Number(x) < 0 ? ~Number(x) : Number(x))),
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
