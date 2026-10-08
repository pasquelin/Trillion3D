// The triangle and slab bodies before their rewrites, word for word but their names: the oracles
// `triangleSlabMoves.test.ts` holds the shipped ones to — `triangleCross` and `triangleArea` before
// the corners and edges in locals, `slabCut` before its swap through a local.
import type { NumberSink } from '../matrix/matrix4.ts'
import { length3 } from '../vector/vector.ts'
import { crossVector3Before } from '../vector/vectorBefore.fixture.ts'

const EDGES = new Float64Array(6)
const CROSS = new Float64Array(3)

export function triangleCrossBefore<T extends NumberSink>(
  out: T,
  o: number,
  v: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
) {
  EDGES[0] = v[b] - v[a]
  EDGES[1] = v[b + 1] - v[a + 1]
  EDGES[2] = v[b + 2] - v[a + 2]
  EDGES[3] = v[c] - v[a]
  EDGES[4] = v[c + 1] - v[a + 1]
  EDGES[5] = v[c + 2] - v[a + 2]
  return crossVector3Before(out, EDGES, EDGES, o, 0, 3)
}

export function triangleAreaBefore(v: ArrayLike<number>, a: number, b: number, c: number) {
  triangleCrossBefore(CROSS, 0, v, a, b, c)
  return length3(CROSS[0], CROSS[1], CROSS[2]) / 2
}

export function slabCutBefore(
  span: Float64Array,
  low: ArrayLike<number>,
  lowAt: number,
  high: ArrayLike<number>,
  highAt: number,
  o: ArrayLike<number>,
  d: ArrayLike<number>,
) {
  let near = span[0],
    far = span[1]
  for (let k = 0; k < 3; k++) {
    const lower = low[lowAt + k],
      upper = high[highAt + k]
    if (d[k] === 0) {
      if (o[k] < lower || o[k] > upper) return false
      continue
    }
    let a = (lower - o[k]) / d[k],
      b = (upper - o[k]) / d[k]
    if (a > b) [a, b] = [b, a]
    if (a > near) near = a
    if (b < far) far = b
    if (near > far) return false
  }
  span[0] = near
  span[1] = far
  return true
}
