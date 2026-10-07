// #836, #1483: admission reads the readback's requests (#478) in the order the GPU ranked them for
// a short pool. Past the pool it keeps the coarsest levels whole, from a room the image's arrivals
// never move, so a still view settles on one queue.
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec } from '../../page/selection/selection.ts'
import { createGroupClosure } from '../../page/cut/groupClosure.ts'
import { createCutDelta } from '../cut/delta.ts'
import { readbackOf, world } from './sets.fixture.ts'
import { lruCache, pageOf, placement } from './residentEnsurer.fixture.ts'
import { createRequestAdmission } from './requestAdmission.ts'
import { createWebgpuResidencyQueue } from './queue.ts'
import { createWebgpuPinUpdater } from './pinUpdater.ts'

/** The placement `r ← m ← a, b` (`r` the pinned cover) beside loose pages: `c0` at level 2,
 *  `m0`, `m1` at level 1, `f0`, `f1` at level 0. */
function gpuCut() {
  const { pages, root } = placement()
  pages[1].level = 1
  const loose = ['c0', 'm0', 'm1', 'f0', 'f1'].map(pageOf)
  loose.forEach((page, i) => (page.level = [2, 1, 1, 0, 0][i]))
  const closure = createGroupClosure(
    [root],
    {
      baseOfRoot: Int32Array.from([0]),
      rootOfPacked: Int32Array.from([...pages, ...loose], (_, i) => (i < pages.length ? 0 : -1)),
    },
    [...pages, ...loose],
  )
  const w = world([...pages, ...loose], [pages[0]])
  const admit = createRequestAdmission(w.sets, w.tracking, closure, (id) => w.packed[id])
  const id = (url: string) => w.packed.findIndex((page) => page.url === url)
  const drawn = createCutDelta(w.packed)
  /** One image: the readback's requests, ranked by the GPU, then admission at `room`. */
  const image = (room: number, urls: string, draws = '', ranked = true) => {
    const pageIds = urls.split(' ').map(id)
    w.delta.apply(pageIds)
    closure.apply(w.delta)
    w.sets.applyCut(closure.delta)
    drawn.apply(draws ? draws.split(' ').map(id) : [])
    w.sets.applyDrawn(drawn)
    const readback = ranked
      ? readbackOf(pageIds, w.packed, w.tracking.topLevel)
      : { uniforms: { admitByLevel: false }, result: { pageIds } }
    admit(room, { cuts: [readback], first: null })
  }
  const url = (key: number) => w.tracking.pageCatalog[key]
  const queue = () => Array.from(w.tracking.wanted.list.subarray(0, w.tracking.wanted.count), url)
  return { ...w, closure, admit, image, queue }
}

test('past the pool, the queue keeps the coarsest levels whole, in the GPU’s order', () => {
  const cut = gpuCut()
  cut.image(3, 'f0 m0 f1 c0 m1')
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1'], 'levels 2 and 1 whole, level 0 left out')
  cut.image(4, 'f0 m0 f1 c0 m1')
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1', 'f0'], 'the straddled level in request order')
  cut.image(8, 'f0 m0 f1 c0 m1')
  assert.deepEqual(new Set(cut.queue()), new Set(['c0', 'm0', 'm1', 'f0', 'f1']), 'all fits')
  assert.ok(cut.admit.hostBytes() > 0, 'its tables are counted in the host tables')
})

// #1237: a page of the group a root replaces is the pool's floor (`minimumCapacity.ts`): past the
// pool it goes first, above every level, so the root the view refuses is replaced before any detail.
// A readback cut while the pool still held the views' cuts is in the cut's order: the walk files
// every request instead of stopping at the first finer one, so a coarser one behind is kept.
test('a readback the GPU did not rank by level is walked whole', () => {
  const cut = gpuCut()
  cut.image(1, 'm0 f0 c0', '', false)
  assert.deepEqual(cut.queue(), ['c0'], 'the coarsest level, though it came last')
})

// The pool turns short past the cuts and whole again a tenth below: no flip at its edge.
test('the pool short of the cuts keeps its ranking until they fall a tenth below it', () => {
  const cut = gpuCut()
  cut.image(8, 'f0 m0 f1 c0 m1')
  const desired = cut.sets.desiredCount
  /** The verdict an image reads at `room`, then the admission that settles it. */
  const settled = (room: number) => {
    const verdict = cut.admit.short(room)
    assert.equal(cut.admit.short(room), verdict, 'read alone, the verdict moves nothing')
    cut.admit(room, { cuts: [], first: null })
    return verdict
  }
  assert.equal(settled(desired), false, 'the cuts fit')
  assert.equal(settled(desired - 1), true, 'past the pool: short')
  assert.equal(settled(desired), true, 'back at the edge: still short')
  assert.equal(settled(ceilDiv(desired, 0.9) + 1), false, 'a tenth below: whole')
  assert.equal(settled(desired), false, 'and whole at the edge again')
})

test("past the pool, a page a root's group replaces goes first, whatever its level", () => {
  const cut = gpuCut()
  cut.packed.find((page) => page.url === 'f0')!.rootChild = true
  cut.image(1, 'f0 m0 f1 c0 m1')
  assert.deepEqual(cut.queue(), ['f0'], 'the floor before the coarsest level')
  cut.image(4, 'f0 m0 f1 c0 m1')
  assert.deepEqual(cut.queue(), ['f0', 'c0', 'm0', 'm1'], 'then the coarsest levels whole')
})

test('a request brings the groups its cut rule needs, filed at their own level', () => {
  const cut = gpuCut()
  cut.image(3, 'f0 a c0')
  assert.deepEqual(cut.queue(), ['c0', 'm', 'f0'], 'the parent `m` before any level-0 page')
  cut.image(4, 'f0 a c0')
  assert.deepEqual(cut.queue(), ['c0', 'm', 'f0', 'a'])
})

test('a readback that reorders equal requests leaves the queue as it is', () => {
  const cut = gpuCut()
  cut.image(4, 'f0 m0 f1 c0 m1')
  const revision = cut.sets.acceptedRevision
  // The GPU orders requests of one rank by the race of its threads: the next readback swaps them.
  cut.image(4, 'f1 m1 f0 c0 m0')
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1', 'f0'], 'the page already queued keeps its slot')
  assert.equal(cut.sets.acceptedRevision, revision, 'nothing rewritten: the view settles')
})

test('a room that shrinks inside a level keeps what the queue holds, in its order', () => {
  const cut = gpuCut()
  cut.image(8, 'f0 m0 f1 c0 m1')
  const held = cut.queue().filter((page) => page.startsWith('f'))
  // The next readback lists the level-0 pages the other way round, and the room drops by one.
  cut.image(4, 'f1 m0 f0 c0 m1')
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1', held[0]], 'the first held, not the first asked')
})

test('what the image draws never moves the room: a cut the pool holds is queued whole', () => {
  const cut = gpuCut()
  // The image still draws `c0` and `m` from the last cut while the new one asks for two pages.
  cut.image(8, 'c0 a')
  cut.image(2, 'f0 f1', 'c0 m')
  assert.deepEqual(new Set(cut.queue()), new Set(['f0', 'f1']), 'drawn pages are not counted')
  cut.image(1, 'f0 f1 m0', 'c0 m')
  assert.deepEqual(cut.queue(), ['m0'], 'past the pool, the room is still the pool')
})

test('a page the image keeps is pinned once it arrives', () => {
  const cut = gpuCut()
  const cache = lruCache(8)
  const pins = createWebgpuPinUpdater({
    tracking: cut.tracking,
    sets: cut.sets,
    bootstrapUrls: new Set(),
    deferredDrops: new Set(),
    byUrl: new Map(),
    parentsOf: () => [] as PageRec[],
    traceEnabled: false,
    traceDiagnostic: () => {},
  })
  const queue = createWebgpuResidencyQueue({
    tracking: cut.tracking,
    sets: cut.sets,
    recordOf: (id) => cut.packed[id],
    room: () => 8,
    getCache: () => cache as never,
    getFrame: () => 0,
    updatePins: () => pins(cache as never, [], 0, () => {}),
    closure: createGroupClosure(
      [],
      { baseOfRoot: new Int32Array(0), rootOfPacked: new Int32Array(0) },
      cut.packed,
    ),
    ensureResident: Object.assign(async () => {}, { revision: () => 0, touchLower() {} }),
    markLost() {},
    traceEnabled: false,
    traceDiagnostic: () => {},
    diagnosticFailure: () => {},
  })
  // The image draws `c0` outside the queue before its bytes are in the pool.
  cut.image(8, 'f0', 'c0')
  queue.queueCuts({ cuts: [], first: null })
  assert.equal(cache.pins.has('c0'), false, 'nothing to pin yet')
  void cache.load('c0')
  queue.queueCuts({ cuts: [], first: null })
  assert.equal(cache.pins.has('c0'), true, 'pinned on the pin step after its arrival')
})
