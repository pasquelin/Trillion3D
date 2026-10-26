import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fixturePages,
  fixtureTotals,
  fixtureUniforms,
  mountCutAdopter,
  peekOnly,
} from './adopter.fixture.ts'
import type { GpuCut } from '../../../gpu/core/selection.ts'
import type { PageRec } from '../../selection/types.ts'
import type { RankList } from './copyRanks.ts'

/** A readback of `ids`, all drawable, whose header carries `totals`. */
const readback = (ids: number[], uniforms = fixtureUniforms(), totals = fixtureTotals()) =>
  ({
    uniforms,
    result: { pageIds: ids, drawablePageIds: ids, frustumRejected: 0, lodLevel: 0, ...totals },
  }) as GpuCut

function banc(ids: number[]) {
  const packedPages = fixturePages(ids.length, (i) => i % 3 === 2)
  const cut = readback(ids, fixtureUniforms(), fixtureTotals({ selectedTriangles: 15 }))
  let peeked: GpuCut | null = cut
  const mounted = mountCutAdopter({
    packedPages,
    uniforms: fixtureUniforms(),
    selection: () => peekOnly(() => peeked),
  })
  return {
    ...mounted,
    packedPages,
    cut,
    montre: (next: GpuCut | null) => (peeked = next),
  }
}

test('a shown list already held does not remake the drawable list, and yields the same counts', () => {
  const b = banc([0, 1, 2, 3, 4])
  assert.equal(b.adopter.adopt(), true)
  const { cutHeld: tenuPremier, listsRewritten: ecritPremier, ...premiers } = b.adopter.metrics
  assert.equal(tenuPremier, false, 'the first shown list is not the one that was held')
  assert.equal(ecritPremier, true, 'and it rewrote the lists')
  const listeShown = b.shown
  const contenu = [...b.shown]
  // Spot a rewrite without depending on a clock: an intruder that only a rewrite erases.
  const intrus = { url: 'intrus' } as unknown as PageRec
  b.shown.push(intrus)
  assert.equal(b.adopter.adopt(), true)
  assert.equal(b.shown, listeShown, 'the array itself does not change')
  assert.equal(b.shown.at(-1), intrus, 'the held list is not remade')
  const { cutHeld: tenuSecond, listsRewritten: ecritSecond, ...seconds } = b.adopter.metrics
  assert.deepEqual(seconds, premiers, 'the counts are those of the same shown list')
  assert.equal(tenuSecond, true, 'the held shown list is announced as such')
  assert.equal(ecritSecond, false, 'and nothing was rewritten')
  b.shown.pop()

  // Totals are the header's, not the list's: totals the GPU changes without moving the list are
  // published as-is, and the list stays that of the held shown list.
  const totals = fixtureTotals({ selectedTriangles: 15, transparentTriangles: 15 })
  b.montre(readback([0, 1, 2, 3, 4], b.cut.uniforms, totals))
  assert.equal(b.adopter.adopt(), true)
  assert.equal(b.adopter.metrics.selectedTriangles, 15, "the totals are the header's")
  assert.equal(b.adopter.metrics.transparentTriangles, 15)
  assert.equal(b.adopter.metrics.listsRewritten, false, 'and no list moved')
  assert.deepEqual(b.shown, contenu, 'the list stayed that of the shown list')
})

const ranksOf = (list: RankList) => Array.from(list.ids.subarray(0, list.count))

test('the packed ranks follow the cut rank by rank, the live count only, across a shorter cut', () => {
  const b = banc([0, 1, 2, 3, 4, 5])
  b.adopter.adopt()
  assert.deepEqual(ranksOf(b.desiredPacked), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(ranksOf(b.shownPacked), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(
    b.shown.map((page) => page.url),
    b.packedPages.slice(0, 6).map((page) => page.url),
  )
  b.montre(readback([4, 1], b.cut.uniforms))
  b.adopter.adopt()
  assert.deepEqual(ranksOf(b.desiredPacked), [4, 1], 'no stale tail of the longer cut')
  assert.deepEqual(ranksOf(b.shownPacked), [4, 1])
  assert.equal(b.shown.length, 2)
})

// A readback cut under a camera the frame has left decides no list of the image, but its counts are
// the latest the GPU gave: they follow it, so the stats do not stand still while the camera moves.
test('a readback of another camera is not adopted, and its counts are', () => {
  const b = banc([0, 1, 2, 3, 4])
  const moved = fixtureUniforms()
  moved.cameraWorld[0] += 1
  b.montre(readback([0, 1, 2, 3, 4], moved, fixtureTotals({ selectedTriangles: 777 })))
  assert.equal(b.adopter.adopt(), false, 'its lists wait for the camera in place')
  assert.equal(b.adopter.metrics.counted, true)
  assert.equal(b.adopter.metrics.selectedTriangles, 777, 'the counts are the readback own')
})

test('a new shown list remakes the list, and the one held before comes back whole', () => {
  const b = banc([0, 1, 2, 3, 4])
  assert.equal(b.adopter.adopt(), true)
  const attendu = [...b.shown]
  b.montre(readback([3, 1], b.cut.uniforms, fixtureTotals({ selectedTriangles: 4 + 2 })))
  assert.equal(b.adopter.adopt(), true)
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p3', 'p1'],
  )
  assert.equal(b.adopter.metrics.selectedTriangles, 4 + 2)

  // The first readback again: its whole list is remade, not the difference alone.
  b.montre(b.cut)
  assert.equal(b.adopter.adopt(), true)
  assert.deepEqual(b.shown, attendu)
})

test('a NEW shown list that republishes the same ids rewrites nothing', () => {
  const b = banc([0, 1, 2, 3, 4])
  assert.equal(b.adopter.adopt(), true)
  const contenu = [...b.shown]
  // That is the still-pose case: the GPU yields a shown list per frame, and that shown list is
  // the same. A different object carrying the same id sequence does not change the image by a pixel.
  for (let image = 0; image < 3; image++) {
    b.montre(readback([0, 1, 2, 3, 4], b.cut.uniforms))
    assert.equal(b.adopter.adopt(), true, 'the shown list is adopted')
    assert.equal(
      b.adopter.metrics.listsRewritten,
      false,
      'an identical shown list rewrites no list: the held-frame witness must survive',
    )
    assert.equal(b.adopter.metrics.cutHeld, true)
    assert.deepEqual(b.shown, contenu, 'and the displayed list is the same')
  }
})

test('a drawable sequence that would repeat an id displays it only once', () => {
  // Kernel compaction writes strictly increasing ranks, hence without a duplicate: each live page
  // is visited once and its rank is that of its own prefix sum. The displayed list is now the one
  // the difference writes, which dedups by epoch mark — a damaged shown list therefore yields a
  // page once and not twice.
  const b = banc([0, 1, 2])
  b.montre({
    uniforms: b.cut.uniforms,
    result: { ...readback([0, 1]).result, drawablePageIds: [0, 1, 1, 0] },
  } as GpuCut)
  assert.equal(b.adopter.adopt(), true)
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p0', 'p1'],
  )
})

// #1483: a list the device could not grow is read by its head, while the frame's mask draws the
// whole cut: a page past the head has not left it, so a truncated readout enters pages, never
// makes one exit.
test('a truncated readout names its head and keeps every page held past it', () => {
  const b = banc([0, 1, 2, 3, 4])
  assert.equal(b.adopter.adopt(), true)
  const head = readback([4, 0], b.cut.uniforms)
  b.montre({ ...head, result: { ...head.result, truncated: true } })
  assert.equal(b.adopter.adopt(), true)
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p4', 'p0', 'p1', 'p2', 'p3'],
    'the head first, then what was held past it, in its order',
  )
  assert.equal(b.delta.exitedCount, 0, 'no page left the asked cut')
  // A whole readout after it is a difference as any other.
  b.montre(readback([4, 0], b.cut.uniforms))
  assert.equal(b.adopter.adopt(), true)
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p4', 'p0'],
  )
})
