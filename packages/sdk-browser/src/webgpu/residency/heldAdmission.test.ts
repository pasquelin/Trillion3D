// #974, #1483: past the pool, admission keeps whole coarse levels and cuts in the one that
// straddles (`rankedQueue.ts`); only a drawn capture's readback is walked, once.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec } from '../../page/selection/types.ts'
import { createRequestAdmission } from './requestAdmission.ts'
import { keysOf, queueOf, readbackOf, rec, world } from './sets.fixture.ts'
import { lcgMaskedRandom } from '../../../../math/src/sequence/seeded.fixture.ts'

/** A reproducible pseudo-random stream: the sweep below is the same on every run. */
const stream = lcgMaskedRandom

/** How many pages of each level the queue must hold: whole coarse levels, then what the room
 *  leaves of the level it straddles, nothing finer. A page counts at its coarsest placement. */
function expectedPerLevel(cut: readonly PageRec[], cover: Set<string>, room: number) {
  const levelOf = new Map<string, number>()
  for (const page of cut)
    if (!cover.has(page.url))
      levelOf.set(page.url, Math.max(levelOf.get(page.url) ?? -1, page.level ?? 0))
  const perLevel = new Map<number, number>()
  for (const level of levelOf.values()) perLevel.set(level, (perLevel.get(level) ?? 0) + 1)
  const taken = new Map<number, number>()
  let left = room
  for (const level of [...perLevel.keys()].sort((a, b) => b - a)) {
    taken.set(level, Math.min(perLevel.get(level)!, left))
    left = Math.max(0, left - perLevel.get(level)!)
  }
  return { levelOf, taken, pages: levelOf.size }
}

test('admission keeps whole coarse levels and cuts in the one that straddles', () => {
  const next = stream(20260928)
  for (let trial = 0; trial < 200; trial++) {
    const urls = 1 + Math.floor(next() * 40)
    const packed = Array.from({ length: Math.floor(next() * 120) }, () =>
      rec(`p${Math.floor(next() * urls)}`, Math.floor(next() * 13)),
    )
    const cover = packed.filter(() => next() < 0.1).map((page) => rec(page.url, 0))
    const w = world(packed, cover)
    const room = Math.floor(next() * (packed.length + 3))
    w.delta.apply(packed.map((_, id) => id))
    w.cut()
    const want = expectedPerLevel(packed, new Set(cover.map((page) => page.url)), room)
    assert.equal(w.budget(room), want.pages > room, `trial ${trial}: over budget`)
    if (want.pages <= room) continue
    const queued = queueOf(w.tracking.wanted).map((key) => w.tracking.pageCatalog[key])
    assert.equal(new Set(queued).size, room, `trial ${trial}: one slot per page, the room full`)
    const counted = new Map<number, number>()
    for (const url of queued) {
      const level = want.levelOf.get(url)!
      counted.set(level, (counted.get(level) ?? 0) + 1)
    }
    for (const [level, count] of want.taken)
      assert.equal(counted.get(level) ?? 0, count, `trial ${trial}: pages taken at level ${level}`)
  }
})

test('a shared address ranks at its coarsest holder, and at the next one once it leaves', () => {
  // Index pages are content-addressed (#824): `shared` is held by a fine and a coarse placement.
  const w = world([rec('shared', 0), rec('mid', 1), rec('shared', 2), rec('fine', 0)])
  const url = (key: number) => w.tracking.pageCatalog[key]
  w.delta.apply([0, 1, 2, 3])
  w.cut()
  assert.equal(w.budget(1), true)
  assert.deepEqual(queueOf(w.tracking.wanted).map(url), ['shared'], 'ahead of the mid page')
  w.delta.apply([0, 1, 3])
  w.cut()
  w.budget(1)
  assert.deepEqual(queueOf(w.tracking.wanted).map(url), ['mid'], 'filed at level 0 now')
})

test("the views' readbacks are never walked; a drawn capture's is, once, its asks lifted first", () => {
  const w = world(Array.from({ length: 8 }, (_, i) => rec(`p${i}`, i % 4)))
  const walks = { requests: 0 }
  const admission = createRequestAdmission(w.sets, w.tracking, {
    closeOver: (ids, visit, full) => (walks.requests++, w.closure.closeOver(ids, visit, full)),
  })
  w.delta.apply([0, 1, 2, 3, 4, 5])
  w.cut()
  const views = { cuts: [readbackOf([0, 1, 2, 3, 4, 5], w.packed, 3)], first: null }
  admission(3, views)
  admission(3, views)
  assert.equal(walks.requests, 0, 'the queue follows the cuts by difference')
  assert.equal(keysOf(w.tracking.wanted).size, 3)
  // A capture asking for the finest pages: they rank above the views' coarser ones.
  const capture = { cuts: views.cuts, first: readbackOf([0, 4], w.packed, 3) }
  admission(3, capture)
  admission(3, capture)
  assert.equal(walks.requests, 1, 'one capture readback, one walk of its requests')
  const queued = keysOf(w.tracking.wanted)
  for (const id of [0, 4]) assert.ok(queued.has(w.tracking.keyOf(w.packed[id])), `p${id} queued`)
})
