import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lcgRandom } from '../sequence/random.ts'
import { lastTrue } from './search.ts'

type Search = (low: number, high: number, holds: (index: number) => boolean) => number

/** The same search on BigInt bounds, whose midpoints never round. */
function lastTrueExact(lo: bigint, hi: bigint, holds: (index: bigint) => boolean) {
  while (lo < hi) {
    const mid = lo + (hi - lo + 1n) / 2n
    if (holds(mid)) lo = mid
    else hi = mid - 1n
  }
  return lo
}

/** Runs one search with a counted predicate: throws past `ceil(log2(high − low + 1)) + 1` calls,
 *  which a halving search never needs, so a search that stops shrinking its range fails here
 *  instead of hanging; also throws when the edge the contract never asks is asked. */
function counted(
  search: Search,
  low: number,
  high: number,
  holds: (i: number) => boolean,
  never: number,
) {
  const bound = high <= low ? 0 : (BigInt(high) - BigInt(low)).toString(2).length + 1
  let calls = 0
  return search(low, high, (i) => {
    if (++calls > bound) throw new Error(`[${low}, ${high}]: more than ${bound} calls`)
    if (i === never) throw new Error(`[${low}, ${high}]: asked ${never}`)
    return holds(i)
  })
}

/** Every range `[low, high]` of the window `[start, start + span]`, every edge one past it. */
function sweepWindow(start: number, span: number) {
  for (let a = 0; a <= span; a++)
    for (let b = a - 1; b <= span; b++)
      for (let edge = a - 1; edge <= b + 1; edge++) {
        const low = start + a,
          high = start + b,
          at = start + edge
        const [low64, high64, at64] = [
          BigInt(start) + BigInt(a),
          BigInt(start) + BigInt(b),
          BigInt(start) + BigInt(edge),
        ]
        const label = `[${low}, ${high}] edge ${at}`
        assert.equal(
          counted(lastTrue, low, high, (i) => i <= at, low),
          Number(lastTrueExact(low64, high64, (i) => i <= at64)),
          `lastTrue ${label}`,
        )
      }
}

test('lastTrue stops where the bounds sum past 2^53: the runaway of the summed midpoint', () => {
  // The midpoint `ceilDiv(lo + hi, 2)` rounded back to `lo`: the loop stopped shrinking. Taken
  // from `lo`, the midpoint stays inside.
  const top = Number.MAX_SAFE_INTEGER
  assert.equal(
    counted(lastTrue, top - 1, top, () => true, top - 1),
    top,
  )
})

test('lastTrue matches the exact BigInt search on every range near ±2^53 and from 0', () => {
  sweepWindow(Number.MAX_SAFE_INTEGER - 40, 40)
  sweepWindow(-Number.MAX_SAFE_INTEGER, 40)
  sweepWindow(0, 24)
  // Ranges as wide as the safe integers, bounds and edge drawn from a fixed seed.
  const next = lcgRandom(0x2545f491)
  const draw = () => next() * Number.MAX_SAFE_INTEGER
  for (let k = 0; k < 2000; k++) {
    const low = -Math.floor(draw()),
      high = Math.floor(draw()),
      at = Math.floor(draw()) - Math.floor(draw())
    assert.equal(
      counted(lastTrue, low, high, (i) => i <= at, low),
      Number(lastTrueExact(BigInt(low), BigInt(high), (i) => i <= BigInt(at))),
    )
  }
})
