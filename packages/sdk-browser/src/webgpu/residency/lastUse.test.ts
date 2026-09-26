// #477: the residency cache evicts by last use. A page the image stopped drawing stays for the
// frames the GPU may still be drawing it, then leaves oldest first, and never before the pages
// that depend on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCutDelta } from '../cut/delta.ts';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { LAST_USE_WINDOW as W } from './lastUse.ts';
import { createWebgpuPinUpdater } from './pinUpdater.ts';
import { createPageAdmission } from './admission.ts';
import { createWebgpuResidencySets } from './sets.ts';
import { lruCache, pageOf, placement } from './residentEnsurer.fixture.ts';

const FULL = /ALL_PAGES_PINNED/;

/** The placement `r ← m ← a, b` and root pages `spare`, over a pool of `slots`, driven image by
 *  image in the engine's order: the cut, the drawn list, the budget, then the pins. */
function residency(slots: number, spare: string[]) {
  const { pages, parentsOf } = placement();
  const packed = [...pages, ...spare.map(pageOf)];
  packed.forEach((page, index) => (page.packedIndex = index));
  const tracking = createWebgpuPageTracking(packed);
  const bootstrapKey = new Uint8Array(tracking.keyCount);
  const sets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages: packed });
  const cut = createCutDelta(packed, []),
    drawn = createCutDelta(packed, []);
  const cache = lruCache(slots);
  const pins = createWebgpuPinUpdater({
    tracking,
    sets,
    bootstrapUrls: new Set(),
    deferredDrops: new Set(),
    byUrl: new Map(),
    parentsOf,
    traceEnabled: false,
    traceDiagnostic: () => {},
  });
  const ids = (urls: string[]) => urls.map((url) => packed.findIndex((page) => page.url === url));
  /** Publishes a cut outside an image, as a drained readback does: no pin step follows. */
  const ask = (cutUrls: string[]) => {
    cut.apply(ids(cutUrls));
    sets.applyCut(cut);
  };
  const image = (frame: number, cutUrls: string[], drawnUrls: string[]) => {
    ask(cutUrls);
    drawn.apply(ids(drawnUrls));
    sets.applyDrawn(drawn);
    sets.applyBudget(slots);
    pins(cache as never, [], frame, () => {});
  };
  const load = async (...urls: string[]) => {
    for (const url of urls) await cache.load(url);
  };
  /** Loads `url` into the full pool and names the page it took the slot of. */
  const evict = async (url: string) => {
    const before = [...cache.resident.keys()];
    await cache.load(url);
    return before.find((key) => !cache.resident.has(key));
  };
  /** The upload job's admission: a page the image asks for is loaded and pinned at once. */
  const admission = createPageAdmission({
    getCache: () => cache as never,
    tracking,
    bootstrapKey,
    isLost: () => false,
    hasBytes: () => true,
    parentsOf,
  });
  const admit = (url: string) => admission(packed[ids([url])[0]]);
  return { image, ask, admit, load, evict, cache };
}

test('an ancestor drawn in place of a missing page stays resident under pressure', async () => {
  const world = residency(2, ['x']);
  await world.load('r', 'm');
  // The cut asks for `a` and `b`, whose pages never arrive: the image draws their ancestor `m`.
  world.image(1, ['a', 'b'], ['m']);
  // The drawn list stops naming it — a readback may lag the frames the GPU still draws — while
  // the pages it stands in for are still missing. No arrival may take its slot, nor its parent's.
  for (let frame = 2; frame <= 2 + 2 * W; frame++) {
    world.image(frame, ['a', 'b'], []);
    await assert.rejects(world.load('x'), FULL, `frame ${frame}`);
    assert.ok(world.cache.resident.has('m') && world.cache.resident.has('r'));
  }
});

/** A full pool of two where `y` arrives first but `x` is the first to stop being drawn. */
async function staggered() {
  const world = residency(2, ['x', 'y', 'z', 'w']);
  await world.load('y', 'x');
  world.image(1, [], ['x', 'y']);
  world.image(2, [], ['y']);
  return world;
}

test('a page not drawn for the window becomes evictable, oldest first', async () => {
  const world = await staggered();
  // Within its window, a page the image just drew never leaves.
  for (let frame = 3; frame < 2 + W; frame++) {
    world.image(frame, [], []);
    await assert.rejects(world.load('z'), FULL, `frame ${frame}`);
  }
  // Once both windows are over, the page last used longest ago leaves first.
  world.image(3 + W, [], []);
  assert.equal(await world.evict('z'), 'x');
  assert.equal(await world.evict('w'), 'y');
});

test('a page released after its window goes before the pages a lower tier moved since', async () => {
  const world = residency(2, ['x', 's', 'z']);
  await world.load('x');
  world.image(1, [], ['x']);
  // `s` is a lower tier's page, never pinned; the camera stops drawing `x`, then the tier's next
  // pass moves `s` to the far end of the order, as `residentEnsurer.ts` does every job.
  await world.load('s');
  world.image(2, [], []);
  world.cache.touch('s');
  for (let frame = 3; frame <= 2 + W; frame++) world.image(frame, [], []);
  assert.equal(await world.evict('z'), 'x');
});

test('a parent never leaves before its resident children', async () => {
  const world = residency(4, ['x', 'y', 'z', 'w']);
  await world.load('r', 'm', 'a', 'b');
  // The image draws the leaves; their parent and grandparent are drawn nowhere.
  world.image(1, ['a', 'b'], ['a', 'b']);
  await assert.rejects(world.load('x'), FULL, 'a parent of a drawn page is held');
  world.image(2, [], []);
  // Each arrival is drawn at once, so the only pages that can make room are the placement's.
  const order: string[] = [],
    arrived: string[] = [];
  for (let frame = 3; arrived.length < 4 && frame < 3 + 4 * W; frame++) {
    world.image(frame, [], arrived);
    for (const url of ['x', 'y', 'z', 'w'].slice(arrived.length)) {
      const left = await world.evict(url).catch(() => undefined);
      if (!left) break;
      order.push(left);
      arrived.push(url);
      world.image(frame, [], arrived);
    }
  }
  assert.deepEqual(new Set(order.slice(0, 2)), new Set(['a', 'b']), 'the children leave first');
  assert.deepEqual(order.slice(2), ['m', 'r'], 'then each parent, after its children');
});

test('a tight pool with the window full never refuses a page the image asks for', async () => {
  const world = await staggered();
  // Both slots sit in their window when the camera turns to two pages that are not resident: the
  // window gives way, oldest first, instead of the pool refusing the image's pages.
  world.image(3, ['z', 'w'], []);
  assert.equal(await world.evict('z'), 'x');
  assert.equal(await world.evict('w'), 'y');
});

test('pages the image stopped asking for before they arrived put no pressure on the window', async () => {
  const world = residency(2, ['x', 'y', 'z', 'w']);
  await world.load('x', 'y');
  world.image(1, [], ['x', 'y']);
  // The cut asks for two pages that never arrive, then drops them with the pages it drew.
  world.image(2, ['z', 'w'], ['x', 'y']);
  world.image(3, [], []);
  // Nothing the image keeps asks for a slot: the pages just drawn stay within their window.
  await assert.rejects(world.load('z'), FULL);
});

test('a page pinned on arrival and let go before the pin step still leaves', async () => {
  const world = residency(2, ['x']);
  world.image(1, [], []);
  // A readback asks for `x`, the running upload job pins it on arrival, and the next cut drops it
  // before any pin step saw it kept: it must still wait out its window and leave.
  world.ask(['x']);
  await world.admit('x');
  world.ask([]);
  for (let frame = 2; frame <= 2 + 2 * W; frame++) world.image(frame, [], []);
  assert.ok(!world.cache.pins.has('x'), 'the pin of a page nothing keeps is given back');
});

test('a page pinned on arrival, let go and taken back before the pin step holds its parents', async () => {
  const world = residency(4, []);
  await world.load('r', 'm');
  world.image(1, [], []);
  // A readback asks for `a`, the upload job pins it on arrival, then two more readbacks let it go
  // and take it back before any pin step ran: the pin step must still see it join.
  world.ask(['a']);
  await world.admit('a');
  world.ask([]);
  world.ask(['a']);
  world.image(2, ['a'], []);
  assert.ok(world.cache.pins.has('m') && world.cache.pins.has('r'), 'its parents are held');
});
