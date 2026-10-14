/**
 * HOW FAR EACH PLACEMENT AND PARENT SLOT MOVED SINCE THE LAST COMMIT (`rowTravel.ts`), as the
 * mobility sees its moves (`mobilityMoves.ts`): no world is kept, only two numbers a mover, summed
 * over its moves — a pose `from` → `to` adds `a`, the translation's change, and `b`, the linear
 * part's (Frobenius norm). A point at distance ρ from the mover's local origin then moved by at most
 * `a + b·ρ` (the triangle inequality, move after move). Each grows by 2⁻¹⁸ of the poses'
 * magnitudes: the single-precision terms of a row's sphere that follow them (`../../placement/rowSphere.ts`).
 * And the placements whose rows changed otherwise: those that started moving (their rows were
 * binned as still) or were linked or let go (their world jumped) — `jumped`.
 */
import { resized } from '../../../../math/src/sequence/resized.ts'

/** Relative room for the sphere's single-precision terms that follow the pose. */
const SLACK = 2 ** -18

/** Movers of one kind: each one's sums, and the movers named since the last commit. */
const movers = () => ({ a: new Float64Array(0), b: new Float64Array(0), list: [] as number[] })
type Movers = ReturnType<typeof movers>

export function createTravel() {
  return { ranks: movers(), slots: movers(), jumped: [] as number[] }
}

/** Mover `i` of `m` went from pose `from` — its sixteen from `at`, column-major — to `to`: read in
 *  place, no view made per move. */
export function noteTravel(
  m: Movers,
  i: number,
  from: ArrayLike<number>,
  at: number,
  to: ArrayLike<number>,
) {
  if (i < 0) return
  if (i >= m.a.length) {
    m.a = resized(m.a, i + 1)
    m.b = resized(m.b, i + 1)
  }
  let dt = 0,
    tt = 0,
    dl = 0,
    ll = 0
  for (let k = 0; k < 3; k++) {
    const d = to[12 + k] - from[at + 12 + k]
    dt += d * d
    tt += Math.abs(from[at + 12 + k]) + Math.abs(to[12 + k])
    for (let r = 0; r < 3; r++) {
      const e = to[k * 4 + r] - from[at + k * 4 + r]
      dl += e * e
      ll += Math.abs(from[at + k * 4 + r]) + Math.abs(to[k * 4 + r])
    }
  }
  if (m.a[i] === 0 && m.b[i] === 0) m.list.push(i)
  // The roots rounded up: a double's last place.
  m.a[i] += (Math.sqrt(dt) + SLACK * tt) * (1 + 2 ** -40)
  m.b[i] += (Math.sqrt(dl) + SLACK * ll) * (1 + 2 ** -40)
}

/** The farthest any of `m`'s movers took a point within `reach(i)` of its origin, the sums taken;
 *  a mover whose reach is unbounded is handed to `unbounded` instead (its rows counted whole). */
export function takeFarthest(
  m: Movers,
  reach: (i: number) => number,
  unbounded: (i: number) => void,
) {
  let farthest = 0
  for (const i of m.list) {
    const far = m.a[i] + (m.b[i] > 0 ? m.b[i] * reach(i) : 0)
    if (far < Infinity) farthest = Math.max(farthest, far)
    else unbounded(i)
    m.a[i] = m.b[i] = 0
  }
  m.list.length = 0
  return farthest
}
