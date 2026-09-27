// #836: on the GPU-cut path, admission follows the GPU's sorted requests (#478), never the CPU
// ranking: a page the pool can hold is admitted in request rank with what its cut rule needs, and
// one it cannot is refused, so the image never waits for it and never loses a surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createGroupClosure } from '../../page/cut/groupClosure.ts';
import { createCutPending } from '../cut/pending.ts';
import { createCutDelta } from '../cut/delta.ts';
import { keysOf, world } from './sets.fixture.ts';
import { pageOf, placement } from './residentEnsurer.fixture.ts';
import { createRequestAdmission } from './requestAdmission.ts';

/** The placement `r ← m ← a, b` beside standalone pages `x0…x3`, the root `r` the pinned cover;
 *  every read of a page's level — what the CPU ranking files pages by — is counted. */
function gpuCut() {
  const { pages, root } = placement();
  const loose = ['x0', 'x1', 'x2', 'x3'].map(pageOf);
  const w = world([...pages, ...loose], [pages[0]], (visit) => closure.forEachHeld(visit));
  let levelReads = 0;
  for (const page of w.packed)
    Object.defineProperty(page, 'level', { get: () => (levelReads++, 0), configurable: true });
  const closure = createGroupClosure([root], w.packed);
  const admit = createRequestAdmission(w.sets, w.tracking.keyOf, w.bootstrapKey, closure);
  const pending = createCutPending(
    w.packed,
    closure.delta,
    w.sets.accepts,
    () => w.sets.acceptedRevision,
  );
  const id = (url: string) => w.packed.findIndex((page) => page.url === url);
  /** One GPU-cut image: the readback's requests, sorted by the GPU, then admission at `room`. */
  const image = (room: number, urls: string[]) => {
    const pageIds = urls.map(id);
    w.sets.decideBy(false);
    w.delta.apply(pageIds);
    closure.apply(w.delta);
    w.sets.applyCut(closure.delta);
    pending.apply();
    admit(room, { result: { pageIds } });
  };
  const url = (key: number) => w.tracking.pageCatalog[key];
  const queue = () => Array.from(w.tracking.wanted.list.subarray(0, w.tracking.wanted.count), url);
  const accepted = (urls: string) => urls.split(' ').every((u) => w.sets.accepts(w.packed[id(u)]));
  return { ...w, root, closure, image, queue, accepted, pending, id, levelReads: () => levelReads };
}

test('past the budget, the queue is the requests in the GPU rank, never the coarsest first', () => {
  const cut = gpuCut();
  cut.image(2, ['x2', 'x0', 'x3', 'x1']);
  assert.deepEqual(cut.queue(), ['x2', 'x0'], 'the two highest requests, in their rank');
  assert.equal(cut.accepted('x3') || cut.accepted('x1'), false, 'the rest is refused');
  // The next readback ranks them otherwise: the queue follows it.
  cut.image(2, ['x1', 'x3', 'x0', 'x2']);
  assert.deepEqual(cut.queue(), ['x1', 'x3']);
  // A cut the pool holds whole is the queue itself.
  cut.image(8, ['x1', 'x3', 'x0', 'x2']);
  assert.deepEqual(new Set(cut.queue()), new Set(['x0', 'x1', 'x2', 'x3']));
});

test('a GPU-cut image never reaches the CPU ranking', () => {
  const cut = gpuCut();
  cut.image(2, ['x2', 'x0', 'x3', 'x1']);
  cut.image(2, ['a', 'x1']);
  cut.image(8, ['x0']);
  assert.equal(cut.levelReads(), 0, 'no page was filed by level');
});

test('under starvation the cut never waits for a page the pool cannot hold, and loses no surface', () => {
  const cut = gpuCut();
  for (const page of cut.packed) if (page.url !== 'r') page.array = undefined;
  // `a` needs its group-mate `b` and its parent `m` (`r` is pinned): three slots, two free.
  cut.image(2, ['x0', 'a', 'x1']);
  assert.deepEqual(
    cut.queue(),
    ['x0'],
    'a request whose closure overruns is refused, and those below',
  );
  assert.equal(cut.accepted('a') || cut.accepted('b') || cut.accepted('m'), false);
  assert.deepEqual(
    cut.pending.records.map((page: PageRec) => page.url),
    ['x0'],
    'only the page the pool holds is awaited',
  );
  cut.packed[cut.id('x0')].array = new Uint32Array(1);
  cut.pending.touch(cut.id('x0'));
  assert.equal(cut.pending.count, 0, 'once it arrives, the image waits for nothing');
  // Four slots: `a` is admitted whole, with everything its cut rule needs up to the pinned root.
  cut.image(4, ['x0', 'a', 'x1']);
  assert.deepEqual(cut.queue(), ['x0', 'a', 'b', 'm']);
  assert.ok(cut.accepted('x0 a b m r'), 'no admitted page lacks an ancestor: no hole');
});

test('back on the CPU cut, the ranking weighs the cut the GPU cut left', () => {
  const cut = gpuCut();
  cut.image(8, ['x0', 'x1', 'x2']);
  cut.image(8, ['x1', 'a', 'x3']);
  cut.sets.decideBy(true);
  assert.equal(cut.sets.applyBudget(3), true, 'five pages past the cover weighed against three');
  assert.equal(cut.tracking.wanted.count, 3);
  assert.equal(cut.sets.applyBudget(8), false, 'and the whole cut fits eight');
  assert.deepEqual(keysOf(cut.tracking.wanted).size, 5);
});

test('what the image draws outside the queue, with the groups it needs, holds its slots', () => {
  const cut = gpuCut();
  // The image draws `a`: its group-mate `b` and parent `m` are held with it, the cover `r` aside.
  const drawn = createGroupClosure([cut.root], cut.packed),
    delta = createCutDelta(cut.packed, []);
  delta.apply([cut.id('a')]);
  drawn.apply(delta);
  cut.sets.applyDrawn(drawn.delta);
  assert.equal(cut.sets.heldOutsideQueue, 3);
  cut.image(5, ['x0', 'x1', 'x2', 'x3']);
  assert.deepEqual(cut.queue(), ['x0', 'x1'], 'five slots, three held: two admitted');
  assert.equal(cut.sets.cutFits, false, 'the lower tiers get nothing');
});
