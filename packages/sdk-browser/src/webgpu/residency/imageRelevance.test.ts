import test from 'node:test';
import assert from 'node:assert/strict';
import { frame, scene } from './sets.fixture.ts';
import { createShadowTier } from './shadowTier.ts';
import { createImageRelevance } from './imageRelevance.ts';
import { createGroupClosure } from '../cut/groupClosure.ts';

function world() {
  const w = scene();
  const tier = createShadowTier({
    packedPages: w.packed,
    keyCount: w.tracking.keyCount,
    keyOf: w.tracking.keyOf,
    room: () => 64,
    closeOver: createGroupClosure([], w.packed).closeOver,
  });
  const affectsImage = createImageRelevance({
    tracking: w.tracking,
    bootstrapKey: w.bootstrapKey,
    requests: w.sets.requests,
    casts: tier.has,
  });
  return { ...w, tier, affectsImage };
}

test('an arrival off the cut, the cover, the pins and the light cuts leaves the image alone', () => {
  const w = world();
  frame(w, [2, 3], 64);
  // Pages o1 (cut) and o0 (bootstrap cover) matter; o5 is named by nothing the image reads.
  assert.equal(w.affectsImage([w.packed[2]]), true, 'a page the cut asks for');
  assert.equal(w.affectsImage([w.packed[0]]), true, 'a page of the bootstrap cover');
  assert.equal(w.affectsImage([w.packed[10]]), false, 'a page nothing reads');
  // A bundle counts as soon as one of its clusters counts.
  assert.equal(w.affectsImage([w.packed[10], w.packed[3]]), true, 'a bundle with one cut page');
});

test('a page the cut asks for past the page budget still counts', () => {
  const w = world();
  // Room for nothing: the queue is empty, the cut still asks for o4.
  frame(w, [8, 9], 0);
  assert.equal(w.tracking.wanted.has(w.tracking.keyOf(w.packed[8])), false);
  assert.equal(w.affectsImage([w.packed[8]]), true);
});

test('a caster a light cut asked for counts, and stops counting once the lights let it go', () => {
  const w = world();
  frame(w, [], 64);
  assert.equal(w.affectsImage([w.packed[12]]), false, 'before any light report');
  w.tier.offerIds([12]);
  assert.equal(w.affectsImage([w.packed[12]]), true, 'named by the light cuts');
  w.tier.offerIds([]);
  assert.equal(w.affectsImage([w.packed[12]]), false, 'dropped by the next report');
});

test('a page the cache holds pinned counts, whatever the cut says', () => {
  const w = world();
  frame(w, [], 64);
  w.tracking.markPinned(w.tracking.keyOf(w.packed[14]));
  assert.equal(w.affectsImage([w.packed[14]]), true);
});
