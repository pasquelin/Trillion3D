// #1275: while the GPU maps the pages, the host's table words — a page drawn, withdrawn or adopted
// — are written by the GPU, run from their WGSL (`wordsWgsl.ts`), and kept only for the page the
// GPU says the entry owns: a host frames behind the GPU never makes a page readable for an entry it
// does not hold, and its draw into a page given away withdraws the page's owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { runShadowWords } from './allocRun.fixture.ts';
import { POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';
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
