// #1275: while the GPU maps the pages, the host's table words — a page drawn, withdrawn or adopted
// — are written by the GPU, run from their WGSL (`wordsWgsl.ts`), and kept only for the page the
// GPU says the entry owns: a host frames behind the GPU never makes a page readable for an entry it
// does not hold, its draw into a page given away withdraws the page's owner, and its adoption of a
// page the GPU drew itself leaves that draw readable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { runShadowWords } from './allocRun.fixture.ts';
import { DRAWN_GPU, DRAWN_HOST, DRAWN_NONE, POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';
import { WORDS_HEADER } from './wordsWgsl.ts';

test('a host word is kept for the page its entry owns on the GPU; a draw into another withdraws it', () => {
  const pages = 4,
    data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint8Array((POOL_COUNTS.length + POOL_FIELDS.length * pages) * 4);
  const table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    owner = new Int32Array(state.buffer, POOL_COUNTS.length * 4, pages);
  const send = (...pairs: number[][]) => {
    const words = new Uint32Array(WORDS_HEADER + 2 * pairs.length);
    words[0] = pairs.length;
    words[1] = pages;
    pairs.forEach((pair, i) => words.set(pair, WORDS_HEADER + 2 * i));
    runShadowWords(data, state, new Uint8Array(words.buffer));
  };
  // The GPU maps entry 10 in page 0, drawn, and entry 11 in page 1, not yet.
  owner.set([10, 11, -1, -1]);
  table[10] = 0 | PAGE_MAPPED | PAGE_VALID;
  table[11] = 1 | PAGE_MAPPED;
  // The host draws entry 11 in page 1, which the GPU says it owns: readable.
  send([11, 1 | PAGE_MAPPED | PAGE_VALID]);
  assert.equal(table[11], 1 | PAGE_MAPPED | PAGE_VALID);
  // A frame behind, the host draws entry 12 into page 0, which the GPU gave entry 10: 12 is not
  // mapped for it, and 10, whose depth that draw overwrote, is read no more.
  send([12, 0 | PAGE_MAPPED | PAGE_VALID]);
  assert.equal(table[12], 0);
  assert.equal(table[10], 0 | PAGE_MAPPED);
  // A withdrawal or an unmapping the GPU did not make changes nothing: only the GPU unmaps.
  send([13, 1 | PAGE_MAPPED], [11, 0]);
  assert.equal(table[11], 1 | PAGE_MAPPED | PAGE_VALID);
  assert.equal(table[13], 0);
});

test("the host adopting a page the GPU drew keeps the GPU's draw; its own draw or a withdrawal wins", () => {
  const pages = 2,
    data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint8Array((POOL_COUNTS.length + POOL_FIELDS.length * pages) * 4);
  const table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    fields = new Int32Array(state.buffer, POOL_COUNTS.length * 4),
    drawnBy = fields.subarray(POOL_FIELDS.indexOf('drawnBy') * pages);
  const send = (entry: number, word: number) => {
    const words = Uint32Array.of(1, pages, 0, 0, entry, word);
    runShadowWords(data, state, new Uint8Array(words.buffer));
  };
  // The GPU mapped entry 20 in page 0 and drew it itself (`freshWgsl.ts`).
  fields.set([20, -1]);
  drawnBy[0] = DRAWN_GPU;
  table[20] = 0 | PAGE_MAPPED | PAGE_VALID;
  // The host learns the page and adopts it, stale: its word says not drawn, the GPU's draw stands.
  send(20, 0 | PAGE_MAPPED);
  assert.equal(table[20], 0 | PAGE_MAPPED | PAGE_VALID);
  // Its own draw lands: the word is the host's from now on, and its withdrawal is kept.
  send(20, 0 | PAGE_MAPPED | PAGE_VALID);
  assert.equal(drawnBy[0], DRAWN_HOST);
  send(20, 0 | PAGE_MAPPED);
  assert.equal(table[20], 0 | PAGE_MAPPED);
  // A host draw for an entry the GPU has since moved off the page: the owner is drawn again.
  send(21, 0 | PAGE_MAPPED | PAGE_VALID);
  assert.equal(drawnBy[0], DRAWN_NONE);
});

test('a page that loses its depth while the frame asks for it is listed for the GPU to draw', () => {
  const pages = 3,
    data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint8Array((POOL_COUNTS.length + POOL_FIELDS.length * pages) * 4),
    drawList = new Uint8Array(4 * pages);
  const table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    counts = new Uint32Array(state.buffer, 0, POOL_COUNTS.length),
    fields = new Int32Array(state.buffer, POOL_COUNTS.length * 4),
    field = (name: (typeof POOL_FIELDS)[number]) =>
      fields.subarray(POOL_FIELDS.indexOf(name) * pages, (POOL_FIELDS.indexOf(name) + 1) * pages);
  const send = (entry: number, word: number) => {
    const words = Uint32Array.of(1, pages, 7, 0, entry, word);
    runShadowWords(data, state, new Uint8Array(words.buffer), drawList);
  };
  // Entries 30, 31 and 32 drawn by the host in pages 0, 1 and 2; frame 7 asks for 30 and 32.
  field('owner').set([30, 31, 32]);
  field('requested').set([7, 6, 7]);
  field('drawnBy').fill(DRAWN_HOST);
  [30, 31, 32].forEach((entry, page) => (table[entry] = page | PAGE_MAPPED | PAGE_VALID));
  // The host withdraws 30 (its lamp moved) and 31: 30 is read this frame, so the GPU draws it.
  send(30, 0 | PAGE_MAPPED);
  send(31, 1 | PAGE_MAPPED);
  // A host draw for 33 lands in page 2, which the GPU gave 32: 32 is read this frame.
  send(33, 2 | PAGE_MAPPED | PAGE_VALID);
  const listed = [
    ...new Uint32Array(drawList.buffer).subarray(0, counts[POOL_COUNTS.indexOf('drawn')]),
  ];
  assert.deepEqual(listed, [0, 2], 'the pages the frame reads, once each');
  assert.deepEqual([...field('drawnBy')], [DRAWN_NONE, DRAWN_NONE, DRAWN_NONE]);
  // Withdrawn again, a page already waiting for its draw is not listed twice.
  send(30, 0 | PAGE_MAPPED);
  assert.equal(counts[POOL_COUNTS.indexOf('drawn')], 2);
});
