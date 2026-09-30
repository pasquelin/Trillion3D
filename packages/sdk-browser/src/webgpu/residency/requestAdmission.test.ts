// #836: on the GPU-cut path, admission reads the readback's requests (#478), never the CPU ranking.
// Past the pool it keeps the coarsest levels whole, as the CPU cut's budget does, from a room the
// image's arrivals never move, so a still view settles on one queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createGroupClosure } from '../../page/cut/groupClosure.ts';
import { createCutDelta } from '../cut/delta.ts';
import { keysOf, world } from './sets.fixture.ts';
import { lruCache, pageOf, placement } from './residentEnsurer.fixture.ts';
import { createRequestAdmission } from './requestAdmission.ts';
import { createWebgpuResidencyQueue } from './queue.ts';
import { createWebgpuPinUpdater } from './pinUpdater.ts';

/** The placement `r ← m ← a, b` (`r` the pinned cover) beside loose pages: `c0` at level 2,
 *  `m0`, `m1` at level 1, `f0`, `f1` at level 0. */
function gpuCut() {
  const { pages, root } = placement();
  pages[1].level = 1;
  const loose = ['c0', 'm0', 'm1', 'f0', 'f1'].map(pageOf);
  loose.forEach((page, i) => (page.level = [2, 1, 1, 0, 0][i]));
  const closure = createGroupClosure(
    [root],
    {
      baseOfRoot: Int32Array.from([0]),
      rootOfPacked: Int32Array.from([...pages, ...loose], (_, i) => (i < pages.length ? 0 : -1)),
    },
    [...pages, ...loose],
  );
  const w = world([...pages, ...loose], [pages[0]]);
  const admit = createRequestAdmission(w.sets, w.tracking, closure);
  const id = (url: string) => w.packed.findIndex((page) => page.url === url);
  const drawn = createCutDelta(w.packed);
  /** One GPU-cut image: the readback's requests in the GPU's order, then admission at `room`. */
  const image = (room: number, urls: string, draws = '') => {
    const pageIds = urls.split(' ').map(id);
    w.delta.apply(pageIds);
    closure.apply(w.delta);
    w.sets.applyCut(closure.delta);
    drawn.apply(draws ? draws.split(' ').map(id) : []);
    w.sets.applyDrawn(drawn);
    admit(room, { result: { pageIds, drawablePageIds: [] } } as never);
  };
  const url = (key: number) => w.tracking.pageCatalog[key];
  const queue = () => Array.from(w.tracking.wanted.list.subarray(0, w.tracking.wanted.count), url);
  return { ...w, closure, admit, image, queue };
}

test('past the pool, the queue keeps the coarsest levels whole, whatever the GPU rank', () => {
  const cut = gpuCut();
  cut.image(3, 'f0 m0 f1 c0 m1');
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1'], 'levels 2 and 1 whole, level 0 left out');
  cut.image(4, 'f0 m0 f1 c0 m1');
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1', 'f0'], 'the straddled level in request order');
  cut.image(8, 'f0 m0 f1 c0 m1');
  assert.deepEqual(new Set(cut.queue()), new Set(['c0', 'm0', 'm1', 'f0', 'f1']), 'all fits');
  assert.ok(cut.admit.hostBytes() > 0, 'its tables are counted in the host tables');
});

// #1237: a page of the group a root replaces is the pool's floor (`minimumCapacity.ts`): past the
// pool it goes first, above every level, so the root the view refuses is replaced before any detail.
test("past the pool, a page a root's group replaces goes first, whatever its level", () => {
  const cut = gpuCut();
  cut.packed.find((page) => page.url === 'f0')!.rootChild = true;
  cut.image(1, 'f0 m0 f1 c0 m1');
  assert.deepEqual(cut.queue(), ['f0'], 'the floor before the coarsest level');
  cut.image(4, 'f0 m0 f1 c0 m1');
  assert.deepEqual(cut.queue(), ['f0', 'c0', 'm0', 'm1'], 'then the coarsest levels whole');
});

test('a request brings the groups its cut rule needs, filed at their own level', () => {
  const cut = gpuCut();
  cut.image(3, 'f0 a c0');
  assert.deepEqual(cut.queue(), ['c0', 'm', 'f0'], 'the parent `m` before any level-0 page');
  cut.image(4, 'f0 a c0');
  assert.deepEqual(cut.queue(), ['c0', 'm', 'f0', 'a']);
});

test('a readback that reorders equal requests leaves the queue as it is', () => {
  const cut = gpuCut();
  cut.image(4, 'f0 m0 f1 c0 m1');
  const revision = cut.sets.acceptedRevision;
  // The GPU orders requests of one rank by the race of its threads: the next readback swaps them.
  cut.image(4, 'f1 m1 f0 c0 m0');
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1', 'f0'], 'the page already queued keeps its slot');
  assert.equal(cut.sets.acceptedRevision, revision, 'nothing rewritten: the view settles');
});

test('a room that shrinks inside a level keeps what the queue holds, in its order', () => {
  const cut = gpuCut();
  cut.image(8, 'f0 m0 f1 c0 m1');
  const held = cut.queue().filter((page) => page.startsWith('f'));
  // The next readback lists the level-0 pages the other way round, and the room drops by one.
  cut.image(4, 'f1 m0 f0 c0 m1');
  assert.deepEqual(cut.queue(), ['c0', 'm0', 'm1', held[0]], 'the first held, not the first asked');
});

test('what the image draws never moves the room: a cut the pool holds is queued whole', () => {
  const cut = gpuCut();
  // The image still draws `c0` and `m` from the last cut while the new one asks for two pages.
  cut.image(8, 'c0 a');
  cut.image(2, 'f0 f1', 'c0 m');
  assert.deepEqual(new Set(cut.queue()), new Set(['f0', 'f1']), 'drawn pages are not counted');
  cut.image(1, 'f0 f1 m0', 'c0 m');
  assert.deepEqual(cut.queue(), ['m0'], 'past the pool, the room is still the pool');
});

test('back on the CPU cut, the ranking weighs the cut the GPU cut left', () => {
  const cut = gpuCut();
  cut.image(8, 'f0 f1 m0');
  cut.image(8, 'f1 a c0');
  assert.equal(cut.admit.held(3), true, 'five pages past the cover weighed against three');
  assert.deepEqual(cut.queue().slice(0, 2), ['c0', 'm'], 'coarsest first');
  assert.equal(cut.admit.held(8), false, 'and the whole cut fits eight');
  assert.equal(keysOf(cut.tracking.wanted).size, 5);
});

test('on the GPU cut, a page the image keeps is pinned once it arrives', () => {
  const cut = gpuCut();
  const cache = lruCache(8);
  const pins = createWebgpuPinUpdater({
    tracking: cut.tracking,
    sets: cut.sets,
    bootstrapUrls: new Set(),
    deferredDrops: new Set(),
    byUrl: new Map(),
    parentsOf: () => [] as PageRec[],
    traceEnabled: false,
    traceDiagnostic: () => {},
  });
  const queue = createWebgpuResidencyQueue({
    tracking: cut.tracking,
    sets: cut.sets,
    room: () => 8,
    getCache: () => cache as never,
    getFrame: () => 0,
    updatePins: () => pins(cache as never, [], 0, () => {}),
    closure: createGroupClosure(
      [],
      { baseOfRoot: new Int32Array(0), rootOfPacked: new Int32Array(0) },
      cut.packed,
    ),
    ensureResident: async () => {},
    markLost() {},
    traceEnabled: false,
    traceDiagnostic: () => {},
    diagnosticFailure: () => {},
  });
  // The image draws `c0` outside the queue before its bytes are in the pool.
  cut.image(8, 'f0', 'c0');
  queue.queueGpuCutResidency(null);
  assert.equal(cache.pins.has('c0'), false, 'nothing to pin yet');
  void cache.load('c0');
  queue.queueGpuCutResidency(null);
  assert.equal(cache.pins.has('c0'), true, 'pinned on the pin step after its arrival');
});
