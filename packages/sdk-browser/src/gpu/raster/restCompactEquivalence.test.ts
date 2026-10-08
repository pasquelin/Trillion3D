import test from 'node:test'
import assert from 'node:assert/strict'
import { BASE_SLOTS, HALF_SLOTS } from '../draw/contract.ts'
import { VERDICT_KEPT, VERDICT_OCCLUDER, VERDICT_REJECTED } from '../partition/contract.ts'
import { REST_COMPACT_WORKGROUP as TILE } from './restCompactWgsl.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

// The tested half is compacted (`restCount`, `restScan`, `restScatter`) rather than truncated
// after its last survivor (`restMark`, `restApply`), which would still draw the rejected
// instances before it, each vertex discarded by the vertex stage. Below, both transcribed line by
// line:
// the second pass must draw the same instances, in the same order, minus every rejected one — on
// random slot layouts and verdicts, slots of more tiles than lanes, slots longer than the
// dispatch, and empty ones.

const NONE = 0xffffffff
type Frame = {
  instances: Uint32Array
  indirect: Uint32Array
  offsets: number[]
  hizSlots: Uint32Array
  hizFlags: Uint32Array
  restSlots: number
  tiles: number
}

const restSlotAt = (n: number) =>
  Math.floor(n / HALF_SLOTS) * BASE_SLOTS + HALF_SLOTS + (n % HALF_SLOTS)
const survives = (f: Frame, row: number) =>
  !(f.hizSlots[row] !== NONE && f.hizFlags[f.hizSlots[row]] === VERDICT_REJECTED)

/** Truncation: the count becomes the rank of the last survivor the dispatch reaches. */
function truncate(f: Frame) {
  for (let n = 0; n < f.restSlots; n++) {
    const slot = restSlotAt(n)
    let last = 0
    for (let x = 0; x < Math.min(f.indirect[slot * 4 + 1], f.tiles * TILE); x++)
      if (survives(f, f.instances[f.offsets[slot] + x])) last = x + 1
    f.indirect[slot * 4 + 1] = last
  }
}

/** Count, scan and scatter, with `work` laid out as the shader lays it out. */
function compact(f: Frame) {
  const copyWords = f.instances.length
  const work = new Uint32Array(copyWords + f.restSlots * (1 + f.tiles)).fill(0xdeadbeef)
  const countWord = (n: number) => copyWords + n
  const tileWord = (n: number, t: number) => copyWords + f.restSlots + n * f.tiles + t
  for (let n = 0; n < f.restSlots; n++)
    for (let t = 0; t < f.tiles; t++) {
      const slot = restSlotAt(n)
      const count = Math.min(f.indirect[slot * 4 + 1], f.tiles * TILE)
      let kept = 0
      for (let lane = 0; lane < TILE; lane++) {
        const x = t * TILE + lane
        if (x >= count) continue
        const at = f.offsets[slot] + x
        work[at] = f.instances[at]
        if (survives(f, work[at])) kept++
      }
      work[tileWord(n, t)] = kept
      if (t === 0) work[countWord(n)] = count
    }
  // The scan over the lanes is a serial exclusive sum of the slot's tile counts, term for term.
  for (let n = 0; n < f.restSlots; n++) {
    let cursor = 0
    for (let t = 0; t < ceilDiv(work[countWord(n)], TILE); t++) {
      const kept = work[tileWord(n, t)]
      work[tileWord(n, t)] = cursor
      cursor += kept
    }
    f.indirect[restSlotAt(n) * 4 + 1] = cursor
  }
  // Tiles in reverse: each reads the copy, so no order between them can change what they write.
  for (let n = 0; n < f.restSlots; n++)
    for (let t = f.tiles - 1; t >= 0; t--) {
      const start = f.offsets[restSlotAt(n)]
      let rank = 0
      for (let lane = 0; lane < TILE; lane++) {
        const x = t * TILE + lane
        if (x >= work[countWord(n)] || !survives(f, work[start + x])) continue
        f.instances[start + work[tileWord(n, t)] + rank++] = work[start + x]
      }
    }
}

/** What the second pass draws per slot: the instances its command counts that the vertex stage
 *  does not discard, in draw order. */
function drawn(f: Frame) {
  return Array.from({ length: f.offsets.length }, (_, slot) =>
    Array.from(f.instances.subarray(f.offsets[slot], f.offsets[slot] + f.indirect[slot * 4 + 1])),
  )
}

function frame(rand: () => number): Frame {
  const layers = 1 + Math.floor(rand() * 3),
    slots = BASE_SLOTS * layers
  const mode = rand()
  const counts = Array.from({ length: slots }, () =>
    rand() < 0.2 ? 0 : Math.floor(rand() * (mode < 0.05 ? 9000 : mode < 0.3 ? 400 : 90)),
  )
  const offsets: number[] = []
  let total = 0
  for (const count of counts) offsets.push((total += count) - count)
  const rows = 1 + Math.floor(rand() * 500)
  const verdicts = [VERDICT_OCCLUDER, VERDICT_KEPT, VERDICT_REJECTED]
  const reject = rand()
  const hizFlags = Uint32Array.from({ length: rows }, () =>
    rand() < reject ? VERDICT_REJECTED : verdicts[Math.floor(rand() * 2)],
  )
  const hizSlots = Uint32Array.from({ length: rows }, (_, row) =>
    rand() < 0.1 ? NONE : (row * 7) % rows,
  )
  const indirect = new Uint32Array(slots * 4)
  counts.forEach((count, slot) => (indirect[slot * 4 + 1] = count))
  return {
    instances: Uint32Array.from({ length: total }, () => Math.floor(rand() * rows)),
    indirect,
    offsets,
    hizSlots,
    hizFlags,
    restSlots: HALF_SLOTS * layers,
    // The dispatch covers the drawable rows, sometimes fewer than a slot holds.
    tiles: ceilDiv(rand() < 0.2 ? 1 + Math.floor(rand() * 100) : Math.max(1, total), TILE),
  }
}

const clone = (f: Frame): Frame => ({
  ...f,
  instances: Uint32Array.from(f.instances),
  indirect: Uint32Array.from(f.indirect),
})

test('compaction draws what truncation drew, in the same order, and no rejected instance', () => {
  const rand = lcgRandom(923)
  let dropped = 0
  for (let trial = 0; trial < 500; trial++) {
    const f = frame(rand),
      before = clone(f),
      after = clone(f)
    truncate(before)
    compact(after)
    const was = drawn(before),
      is = drawn(after)
    for (let slot = 0; slot < was.length; slot++) {
      // An occluder slot is neither truncated nor compacted: it draws as it was.
      const tested = slot % BASE_SLOTS >= HALF_SLOTS
      const kept = tested ? was[slot].filter((row) => survives(f, row)) : was[slot]
      assert.deepEqual(is[slot], kept, `trial ${trial}, slot ${slot}`)
      dropped += was[slot].length - kept.length
    }
  }
  // The sweep did meet rejected instances inside the truncated range.
  assert.ok(dropped > 0)
})

test('edge cases: all rejected draws nothing, all kept is left as it was, half keeps its order', () => {
  // The first two tested slots: a hundred instances from offset 0, a hundred from offset 100.
  const [first, second] = [restSlotAt(0), restSlotAt(1)]
  const edge = (hizSlots: number[]) => {
    const offsets = new Array<number>(BASE_SLOTS).fill(0)
    offsets[second] = 100
    const f: Frame = {
      instances: Uint32Array.from({ length: 200 }, (_, i) => i % 2),
      indirect: new Uint32Array(BASE_SLOTS * 4),
      offsets,
      hizSlots: Uint32Array.from(hizSlots),
      hizFlags: Uint32Array.from([VERDICT_REJECTED]),
      restSlots: HALF_SLOTS,
      tiles: 4,
    }
    f.indirect[first * 4 + 1] = 100
    f.indirect[second * 4 + 1] = 100
    compact(f)
    return [f.indirect[first * 4 + 1], f.indirect[second * 4 + 1], [...f.instances]] as const
  }
  assert.deepEqual(edge([0, 0]).slice(0, 2), [0, 0])
  const kept = edge([NONE, NONE])
  assert.deepEqual(kept, [100, 100, Array.from({ length: 200 }, (_, i) => i % 2)])
  const half = edge([0, NONE])
  assert.deepEqual(half.slice(0, 2), [50, 50])
  assert.deepEqual(half[2].slice(0, 50), new Array(50).fill(1))
  assert.deepEqual(half[2].slice(100, 150), new Array(50).fill(1))
})
