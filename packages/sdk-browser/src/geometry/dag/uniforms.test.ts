// parseDagOutput sizes its arrays ahead of time instead of a typed-array spread and a `push` with
// no capacity. Oracle: the spreading version, in
// `../../../../../bench/oracles/browser/residency.ts`.
//
// THE HEADER IS WIDER THAN THE ORACLE'S: the oracle's four words — a count, frustum reject, the
// level, the flags — are the first of eight, the next two carrying the triangle totals the GPU
// holds, the last two the occlusion's counts (`layout.ts`). The oracle is frozen at four. Each side therefore receives a readback IN
// ITS OWN LAYOUT, with the same values, and the comparison is on what they extract: it is the
// decode that is compared, not the placement of the words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDagOutput } from './uniforms.ts'
import { SELECTION_HEADER_WORDS } from './readoutWords.ts'
import { referenceParseDagOutput } from '../../../../../bench/oracles/browser/residency.ts'
import type { SelectionResult } from '../../gpu/core/selection.ts'

/** The oracle's header: four words, those from before the totals. */
const HEAD_ORACLE = 4

/**
 * The readback reduced to what both sides can carry. `drawablePageIds` is normalised — the oracle
 * only wrote the key when a mask existed, the reused readback always carries it. Fields that only
 * one of the two produces — `truncated`, `peaks`, the `requests` with their page counts and
 * priorities and the occlusion's counts that only the reader takes, `complete` that only the oracle
 * still reads (the cut rule leaves no surface undrawn), and the totals — are STRIPPED and asserted separately: comparing
 * them would ask a side for something it never knew.
 */
const champs = (reading: (Partial<SelectionResult> & { complete?: boolean }) | null) => {
  if (!reading) return reading
  const {
    truncated: _t,
    peaks: _w,
    complete: _c,
    requests: _r,
    occluded: _o,
    postHidden: _h,
    selectedTriangles: _s,
    transparentTriangles: _p,
    ...reste
  } = reading
  return { ...reste, drawablePageIds: reading.drawablePageIds ?? undefined }
}

/** Where a readback's lists lie, in words, as the reader is handed them. */
type ReadbackAt = Parameters<typeof parseDagOutput>[3]

/** The readback in the reader's layout: the header, the requests' first pages, then each request's
 *  priority and page count — one — at its rank of their lists (`priorityWord`, `countWord`,
 *  `readoutWords.ts`); no drawn list. */
function readback(header: number[], pageIds: number[], priorities = pageIds.map((_, s) => s + 1)) {
  const head = SELECTION_HEADER_WORDS,
    at: ReadbackAt = {
      drawn: 0,
      priorities: head + pageIds.length,
      counts: head + 2 * pageIds.length,
    }
  const ints = new Uint32Array(at.counts + pageIds.length)
  ints.set(header, 0)
  ints.set(pageIds, head)
  ints.set(priorities, at.priorities)
  ints.fill(1, at.counts)
  return { bytes: ints.buffer, at }
}

/** The same readback in the oracle's layout: its four words, then the pages. */
function oracleBuffer(header: number[], pageIds: number[]) {
  const ints = new Uint32Array(HEAD_ORACLE + pageIds.length)
  ints.set(header.slice(0, HEAD_ORACLE), 0)
  ints.set(pageIds, HEAD_ORACLE)
  return ints.buffer
}

/** The readback as the GPU returns it: the header and the pages, their priorities and page counts,
 *  then the compacted list; the reader is handed where each list lies. */
function withDrawn(header: number[], pageIds: number[], drawn: number[], pageCount: number) {
  const head = SELECTION_HEADER_WORDS,
    priorities = head + pageCount,
    counts = priorities + pageCount,
    words = counts + pageCount
  const ints = new Uint32Array(words + head + pageCount)
  ints.set(header, 0)
  ints.set(pageIds, head)
  ints.set(
    pageIds.map((_, s) => s + 1),
    priorities,
  )
  ints.set(
    pageIds.map(() => 1),
    counts,
  )
  ints[words] = drawn.length
  ints.set(drawn, words + head)
  return { bytes: ints.buffer, at: { drawn: words, priorities, counts } }
}

/** Both readbacks of the same content, each in its reader's layout. The oracle only receives the
 *  four words it knows how to read: the totals are not submitted to it, it does not know them. */
const pair = (header: number[], pageIds: number[]) => ({
  neuf: readback(header, pageIds),
  oracle: oracleBuffer(header, pageIds),
})
const lire = ({ bytes, at }: { bytes: ArrayBuffer; at: ReadbackAt }) =>
  parseDagOutput(bytes, 0, bytes.byteLength, at)
const lireOracle = (bytes: ArrayBuffer) => referenceParseDagOutput(bytes, 0, bytes.byteLength, 0)

// Bit 0 of word 3 means, with the readback cap (`layout.ts`), "the cut did not fit under the cap",
// a normal situation for an extreme scene — the kernels ran, the frame mask is correct, only the
// LIST is truncated. The readback is returned, and marked; the oracle, which reads that bit as a
// failure ("the cut wrote more ranks than there are clusters"), returns `null`.
test('bit 0 of word 3 declares the readback truncated, without discarding it', () => {
  const { neuf, oracle } = pair([5, 0, 0, 1], [1, 2, 3, 4, 5])
  const reading = lire(neuf)
  assert.ok(reading, 'a truncated readback is still a readback')
  assert.equal(reading.truncated, true)
  assert.deepEqual(reading.pageIds, [1, 2, 3, 4, 5])
  assert.equal(lireOracle(oracle), null, 'what the oracle used to do')
})

test('a readback that fits under the cap is never declared truncated', () => {
  const { neuf } = pair([3, 0, 0, 0], [10, 20, 30])
  assert.equal(lire(neuf)!.truncated, false)
})

test('the host reads the requests in the order the GPU wrote them, and ranks nothing', () => {
  // Each rank is a request's page, a whole word (`request/request.ts`): past the old twenty-two bits too.
  // The GPU wrote them in the order its threads won the counter (`shader/snapshotWgsl.ts`); the
  // reader keeps that order, each priority at its page's rank: the host ranks them.
  const requests = [70, 11, 2 ** 31 + 42, 8, 7]
  const reading = lire(readback([5, 0, 0, 0], requests, [9, 3, 0xffffffe0, 1, 5]))!
  assert.deepEqual(reading.pageIds, requests)
  assert.deepEqual(reading.requests.pages, requests)
  assert.deepEqual(reading.requests.priorities, [9, 3, 0xffffffe0, 1, 5])
})

test('triangle totals are reread as the GPU posted them, no drawn counter beside them', () => {
  // Words 6 and 7 count the occlusion's two passes: whatever they hold, the cut's total is the
  // selected one, already past both passes — what the image draws.
  const { neuf } = pair([3, 0, 0, 0, 900, 90, 700, 200], [10, 20, 30])
  const reading = lire(neuf)!
  assert.equal(reading.selectedTriangles, 900)
  assert.equal(reading.transparentTriangles, 90)
  assert.equal('drawnTriangles' in reading, false, 'no drawn counter is read')
  assert.equal('uncoveredTriangles' in reading, false, 'no uncovered counter is read')
})

test('a normal readback without a mask matches the reference field for field', () => {
  const { neuf, oracle } = pair([3, 42, 2, 0], [10, 20, 30])
  assert.deepEqual(champs(lire(neuf)), champs(lireOracle(oracle)))
  assert.deepEqual(champs(lire(neuf)), {
    pageIds: [10, 20, 30],
    frustumRejected: 42,
    lodLevel: 2,
    drawablePageIds: undefined,
  })
})

test('a page count larger than the buffer holds is clamped identically, with and without a mask', () => {
  const { neuf, oracle } = pair([1000, 0, 0, 0], [1, 2, 3])
  assert.deepEqual(champs(lire(neuf)), champs(lireOracle(oracle)))
  assert.equal(lire(neuf)!.pageIds.length, 3)
})

test('the compacted drawable list is reread as-is, without walking every page', () => {
  const reading = lire(withDrawn([2, 0, 0, 0], [5, 6], [0, 2, 3, 6], 8))
  assert.deepEqual(reading!.pageIds, [5, 6])
  assert.deepEqual(reading!.drawablePageIds, [0, 2, 3, 6])
})

test('a drawable count larger than the readback holds is clamped to what it contains', () => {
  const read = withDrawn([1, 0, 0, 0], [5], [1, 2], 4)
  new Uint32Array(read.bytes)[read.at.drawn] = 1000
  assert.equal(lire(read)!.drawablePageIds!.length, 4)
})

test('an empty buffer (all zero) and a zero-length byte range never crash', () => {
  assert.deepEqual(
    champs(lire(readback([], []))),
    champs(lireOracle(new ArrayBuffer(HEAD_ORACLE * 4))),
  )
  const rien = new ArrayBuffer(0)
  assert.deepEqual(
    champs(lire({ bytes: rien, at: { drawn: 0, priorities: 0, counts: 0 } })),
    champs(lireOracle(rien)),
  )
})
