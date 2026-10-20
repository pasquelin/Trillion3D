// What the partition's and the occlusion test's shipped row routines read when a proof runs them on
// the CPU (`shaderRun`): the builtins they call, a fake pyramid's answers on a 64 × 48 viewport,
// and the tested boxes the partition hands the test.
import { builtins } from '../../../materials/texture/shaderRunBuiltins.fixture.ts'
import { structZero } from '../../../materials/texture/shaderRunStructs.fixture.ts'
import { HIZ_SHADER } from './shader.ts'
import * as C from '../../../geometry/partition/gpu/contract.ts'

type Ref = { get: () => number; set: (value: number) => void }
/** The members of a tested box, in the order the test reads its words (`struct Bounds`). */
const BOUNDS = Object.keys(structZero(HIZ_SHADER)('Bounds') as object)
/** `bitcast<u32>` of the kernels' `i32` rectangle words, or of a depth's `f32`. */
const bitsOf = (x: number) => (Number.isInteger(x) ? x >>> 0 : builtins.bitcast_u32(x))

/** The builtins and the pyramids' answers: a function of what is asked, the same on every run. */
export const rowRoutineScope = {
  // A `u32` atomic wraps: the triangle counts pass 2^32.
  atomicAdd: (p: Ref, n: number) => [p.get(), p.set((p.get() + n) >>> 0)][0],
  bitcast_u32: bitsOf,
  bitcast_i32: (x: number) => x | 0,
  hiddenByPyramid: (rect: number[]) => (rect[0] & 1) === 0,
  // The one pick, clipped to the 64 × 48 viewport; the mip table's offset and width of a level.
  hizRectPick: (rect: number[]) => {
    const r = [
      Math.max(rect[0], 0),
      Math.max(rect[1], 0),
      Math.min(rect[2], 63),
      Math.min(rect[3], 47),
    ]
    const empty = r[2] < r[0] || r[3] < r[1]
    return { rect: r, level: r[0] & 3, coarse: 3, found: !empty && (r[1] & 3) !== 0 }
  },
  hizMip: (l: number) => [l, l],
  pyramidHides: (minX: number, minY: number) => ((minX + minY) & 1) === 0,
}

/** The first `count` boxes the partition wrote to `tested`, each read as the test reads a
 *  `Bounds`. */
export const testedBounds = (tested: readonly number[], count: number) =>
  Array.from({ length: count }, (_, k) => {
    const box: Record<string, number> = Object.fromEntries(
      BOUNDS.map((name, w) => [name, tested[k * C.TESTED_BOX.words + w] ?? 0]),
    )
    for (const side of ['minX', 'minY', 'maxX', 'maxY']) box[side] |= 0
    box.nearest = builtins.bitcast_f32(box.nearest) as number
    return box
  })
