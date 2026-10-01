// #831: while the GPU maps pages, a page it drew itself holds the casters where they stood; the
// host, frames behind, does not map it yet. A mover covering it must still have it drawn again, or
// the moving car leaves a trail of old silhouettes, one per page row (the saw-tooth of #831).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  PAGE_WITHDRAWN,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  planFrame,
  settledSun,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { runShadowWords } from './allocRun.fixture.ts';
import { POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';
import { DRAWN_GPU, DRAWN_HOST, DRAWN_NONE } from './poolDrawn.ts';
import { sentShadowWord } from './wordsWgsl.ts';

/** The entries a moving box sends withdrawn without a host mapping, the GPU mapping or not. */
function withdrawnUnmapped(gpuMaps: boolean) {
  const { store, plan, frame } = settledSun();
  plan.gpu.set(gpuMaps, 0);
  plan.worldChanged([20, 0, 20], [22, 1, 22], true);
  planFrame(plan, store, frame);
  const sent: number[] = [];
  plan.table.flush((first, count) => {
    for (let e = first; e < first + count; e++) {
      const word = sentShadowWord(plan.table, e);
      if (!(word & PAGE_MAPPED) && word & PAGE_WITHDRAWN) sent.push(e);
    }
  });
  return sent;
}

test('a mover sends the entries it covers that the host does not map, only while the GPU maps', () => {
  assert.ok(withdrawnUnmapped(true).length > 0, 'the GPU may hold a draw of them');
  assert.deepEqual(withdrawnUnmapped(false), [], 'the host maps every page itself');
});

test('a withdrawn entry the host does not map loses the GPU draw of its page, drawn again now', () => {
  const pages = 2,
    data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint8Array((POOL_COUNTS.length + POOL_FIELDS.length * pages) * 4),
    drawList = new Uint8Array(4 * pages);
  const table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    fields = new Int32Array(state.buffer, POOL_COUNTS.length * 4),
    at = (name: (typeof POOL_FIELDS)[number], page: number) =>
      POOL_FIELDS.indexOf(name) * pages + page;
  const send = (entry: number) => {
    const words = Uint32Array.of(1, pages, 5, 0, entry, PAGE_WITHDRAWN);
    runShadowWords(data, state, new Uint8Array(words.buffer), drawList);
  };
  // Entry 40 in page 0, drawn by the GPU; entry 41 in page 1, drawn by the host; both read now.
  fields[at('owner', 0)] = 40;
  fields[at('owner', 1)] = 41;
  fields[at('requested', 0)] = fields[at('requested', 1)] = 5;
  fields[at('drawnBy', 0)] = DRAWN_GPU;
  fields[at('drawnBy', 1)] = DRAWN_HOST;
  table[40] = 0 | PAGE_MAPPED | PAGE_VALID;
  table[41] = 1 | PAGE_MAPPED | PAGE_VALID;
  send(40);
  assert.equal(table[40], 0 | PAGE_MAPPED, 'read no more until drawn');
  assert.equal(fields[at('drawnBy', 0)], DRAWN_NONE);
  assert.equal(new Uint32Array(drawList.buffer)[0], 0, 'listed for this frame');
  // A host draw is the host's to withdraw by its own word: this one changes nothing.
  send(41);
  assert.equal(table[41], 1 | PAGE_MAPPED | PAGE_VALID);
  // An entry the GPU does not map either: nothing.
  send(42);
  assert.equal(table[42], 0);
  assert.equal(new Uint32Array(state.buffer)[POOL_COUNTS.indexOf('drawn')], 1);
});
