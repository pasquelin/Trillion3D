import test from 'node:test';
import assert from 'node:assert/strict';
import { frame, scene } from './sets.fixture.ts';
import { createImageRelevance } from './imageRelevance.ts';

function world() {
  const w = scene();
  const affectsImage = createImageRelevance({
    tracking: w.tracking,
    bootstrapKey: w.bootstrapKey,
    requests: w.sets.requests,
  });
  return { ...w, affectsImage };
}

test('an arrival off the cut, the cover and the pins leaves the image alone', () => {
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

test('a page the cache holds pinned counts, whatever the cut says', () => {
  const w = world();
  frame(w, [], 64);
  w.tracking.markPinned(w.tracking.keyOf(w.packed[14]));
  assert.equal(w.affectsImage([w.packed[14]]), true);
});
