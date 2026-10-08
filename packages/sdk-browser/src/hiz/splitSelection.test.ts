import test from 'node:test'
import assert from 'node:assert/strict'
import { rankByDepth } from './depthRank.fixture.ts'
import { HIZ_BOUNDS_VALUES } from './corners.ts'
import { lcgMaskedRandom } from '../../../math/src/sequence/seeded.fixture.ts'

const keyDouble = new Float64Array(1),
  keyWords = new Uint32Array(keyDouble.buffer)

/** Sortable image of a depth: what the split orders on, and nothing else. Engine depth is
 *  reverse-Z — nearest is greatest — so the key is that of the OPPOSITE, and the increasing
 *  order of keys stays nearest to farthest. */
function orderable(value: number) {
  keyDouble[0] = -value
  const low = keyWords[0],
    high = keyWords[1]
  const negative = (high & 0x80000000) !== 0
  return {
    low: negative ? ~low >>> 0 : low,
    high: negative ? ~high >>> 0 : (high ^ 0x80000000) >>> 0,
  }
}

/**
 * The candidates as the stable sort ranks them: those in front of the near plane, on the sortable
 * key, ties broken by their index. The rank the split takes its nearest half from must be this
 * one term for term.
 */
function stableRank(count: number, bounds: Float64Array) {
  const candidates: number[] = []
  for (let i = 0; i < count; i++) if (bounds[i * HIZ_BOUNDS_VALUES + 5] === 0) candidates.push(i)
  const keys = new Map(candidates.map((i) => [i, orderable(bounds[i * HIZ_BOUNDS_VALUES + 4])]))
  return candidates.sort((a, b) => {
    const ka = keys.get(a)!,
      kb = keys.get(b)!
    return ka.high - kb.high || ka.low - kb.low || a - b
  })
}

/** A cut described by its depths alone; `null` clips the near plane. */
function bounds(depths: readonly (number | null)[]) {
  const flat = new Float64Array(Math.max(1, depths.length) * HIZ_BOUNDS_VALUES)
  for (let i = 0; i < depths.length; i++) {
    const depth = depths[i]
    flat[i * HIZ_BOUNDS_VALUES + 5] = depth === null ? 1 : 0
    flat[i * HIZ_BOUNDS_VALUES + 4] = depth ?? 0
  }
  return flat
}

function memeEnsemble(depths: readonly (number | null)[], why: string) {
  const flat = bounds(depths)
  const { inFront, order } = rankByDepth(depths.length, flat)
  assert.deepEqual([...order.subarray(0, inFront)], stableRank(depths.length, flat), why)
}

test('the depth rank of the split is the stable sort', () => {
  memeEnsemble([], 'no box')
  memeEnsemble([null, null], 'all clip the near plane')
  memeEnsemble([0.5], 'a single box')
  memeEnsemble([0.9, 0.1, 0.5, 0.3], 'distinct depths')
  memeEnsemble([0.4, 0.4, 0.4, 0.4, 0.4], 'all equal: the index breaks ties')
  memeEnsemble([0.2, null, 0.2, 0.1, null, 0.9], 'ties and clips mixed')
  memeEnsemble([-0, 0, -0, 0], 'signed zero: the two are not the same key')
  memeEnsemble([Infinity, -Infinity, 0, NaN, 1e-320, -1e-320], 'extreme values')
  memeEnsemble([NaN, NaN, 1, 2], 'NaN, which no numeric comparison orders')
})

test('the depth rank holds on large cuts, on rare keys as on dense keys', () => {
  const rand = lcgMaskedRandom(20260916)
  for (const distinct of [1, 2, 7, 1000, 0]) {
    const count = 4000
    const depths: (number | null)[] = []
    for (let i = 0; i < count; i++)
      depths.push(
        rand() < 0.1
          ? null
          : distinct === 0
            ? rand() * 2 - 1
            : Math.floor(rand() * distinct) / distinct,
      )
    memeEnsemble(depths, `${count} boxes, ${distinct || 'all'} keys`)
  }
})
