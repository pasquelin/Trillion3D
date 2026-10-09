// The root cover counts its holders: the session holds its roots from open, a held cell adds a
// holder to the roots it alone needs. A page joins the cover with its first holder — kept, out of
// what the budget weighs, its address listed — and leaves with its last; the queue loads it before
// any other page, in the held tier. The session's holders never move.
import test from 'node:test'
import assert from 'node:assert/strict'
import { keysOf, rec, world } from './sets.fixture.ts'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidencySets } from './sets.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'
import { ensurerOptions, lruCache, pageOf } from './residentEnsurer.fixture.ts'

/** Six cut pages, levels 0 to 2, and two roots a held cell adds; the session's top apart. */
function scene() {
  const cut = Array.from({ length: 6 }, (_, at) => rec(`p${at}`, at % 3))
  const roots = [rec('held0', 1), rec('held1', 1)]
  const w = world([...cut, ...roots], [rec('top', 3)])
  return { ...w, roots, keys: roots.map((page) => w.tracking.keyOf(page)) }
}

test('a root joins the cover with its first holder and leaves with its last', () => {
  const w = scene()
  const top = w.tracking.keyOf(rec('top', 3))
  w.sets.holdCover(w.roots, true)
  for (const key of w.keys) {
    assert.ok(w.sets.covers(key) && keysOf(w.tracking.keep).has(key), 'covered and kept')
    assert.ok(!keysOf(w.tracking.wanted).has(key), 'never weighed by the budget')
  }
  assert.equal(w.sets.requestedCount, 3, 'asked for with the top')
  const revision = w.sets.acceptedRevision
  w.sets.holdCover(w.roots, true)
  assert.equal(w.sets.acceptedRevision, revision, 'a second holder moves nothing')
  w.sets.holdCover(w.roots, false)
  assert.ok(w.keys.every(w.sets.covers), 'one holder left')
  w.sets.holdCover(w.roots, false)
  for (const key of w.keys) assert.ok(!w.sets.covers(key) && !keysOf(w.tracking.keep).has(key))
  assert.deepEqual([w.bootstrapKey[top], w.sets.requestedCount], [1, 1], "the session's top stays")
})

test('a page the cut asks for leaves the queue while covered, and comes back once let go', () => {
  const w = scene()
  w.delta.apply([0, 1, 2, 3, 4, 5, 6])
  w.cut()
  // Room for the two coarsest levels: the root, level 1, among them.
  w.budget(5)
  const asked = w.keys[0]
  assert.ok(keysOf(w.tracking.wanted).has(asked), 'the coarsest are queued')
  w.sets.holdCover([w.roots[0]], true)
  w.budget(5)
  const wanted = keysOf(w.tracking.wanted)
  assert.ok(!wanted.has(asked) && keysOf(w.tracking.keep).has(asked), 'covered, kept, unweighed')
  assert.equal(wanted.size, 5, 'the room goes to the cut')
  w.sets.holdCover([w.roots[0]], false)
  w.budget(5)
  assert.ok(keysOf(w.tracking.wanted).has(asked), 'asked for by the cut again')
})

test('the queue loads the pages a holder brought before its own, in the held tier', async () => {
  const pages = ['queued', 'held'].map(pageOf)
  const tracking = createWebgpuPageTracking(pages)
  const bootstrapKey = new Uint8Array(tracking.keyCount)
  const sets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages: pages })
  sets.holdCover([pages[1]], true)
  assert.equal(sets.coverSlots, 1, 'one slot taken by the cover')
  tracking.wanted.add(tracking.keyOf(pages[0]), pages[0])
  const cache = lruCache(1)
  const ensure = createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, cache),
    bootstrapKey,
    coverMissing: sets.coverMissing,
  })
  await ensure([pages[0]], 1, 1)
  assert.deepEqual([...cache.resident.keys()], ['held'], 'the cover first: the pool is full')
  assert.ok(cache.held.has('held'), 'held on arrival')
  assert.deepEqual(
    sets.coverMissing((page) => !!cache.get(page.url)),
    [],
    'loaded, it is missing no more',
  )
})
