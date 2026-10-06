// #974: the CPU cut ranks through the GPU cut's admission, off the pages its cut closes over
// (`closure.forEachHeld`). No ranking is kept beside the cut: the GPU cut walks nothing held, and
// the CPU cut walks what it holds only when that moved.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec } from '../../page/selection/selection.ts'
import { createRequestAdmission } from './requestAdmission.ts'
import { keysOf, queueOf, rec, world } from './sets.fixture.ts'

/** A reproducible pseudo-random stream: the sweep below is the same on every run. */
function stream(seed: number) {
  let state = seed
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

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

test('the CPU cut keeps whole coarse levels and cuts in the one that straddles', () => {
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

test('the GPU cut walks nothing held; the CPU cut walks it only when its cut moved', () => {
  const w = world(Array.from({ length: 8 }, (_, i) => rec(`p${i}`, i % 4)))
  const walks = { held: 0, requests: 0 }
  const admission = createRequestAdmission(w.sets, w.tracking, {
    forEachHeld: (visit) => (walks.held++, w.closure.forEachHeld(visit)),
    closeOver: (ids, visit) => (walks.requests++, w.closure.closeOver(ids, visit)),
  })
  const image = (ids: number[]) => {
    w.delta.apply(ids)
    w.cut()
  }
  image([0, 1, 2, 3, 4, 5])
  const readback = { result: { pageIds: [0, 1, 2, 3, 4, 5], drawablePageIds: [] } }
  admission(3, readback as never)
  admission(3, readback as never)
  assert.deepEqual(walks, { held: 0, requests: 1 }, 'one readback, one walk of its requests')
  admission.held(3)
  admission.held(3)
  assert.deepEqual(walks, { held: 1, requests: 1 }, 'the CPU cut takes over: one walk')
  image([0, 1, 2, 3, 4, 5])
  admission.held(3)
  assert.equal(walks.held, 1, 'a CPU cut that moved no page is not ranked again')
  image([1, 2, 3, 4, 5, 6])
  admission.held(3)
  assert.equal(walks.held, 2, 'one that moved is')
  assert.equal(keysOf(w.tracking.wanted).size, 3)
})
