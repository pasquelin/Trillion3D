// #831: an entry the host does not map but the GPU may have drawn goes out withdrawn when a mover
// covers it (`invalidate.ts`). Past four pool pages of changed words the table uploads whole: the
// marks go out with it, or the mover's old silhouette is adopted current. Past what the words hold,
// every page the GPU drew itself is withdrawn. And an entry already sent withdrawn is not sent again
// before a GPU page draw could hold a newer draw of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import {
  PAGE_MAPPED,
  PAGE_VALID,
  PAGE_WITHDRAWN,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { createShadowAllocationBuffers } from './allocBuffers.ts';
import { runShadowWords } from './allocRun.fixture.ts';
import { POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';
import { DRAWN_GPU, DRAWN_HOST, DRAWN_NONE } from './poolDrawn.ts';
import { WORDS_HEADER, shadowWordsWgsl } from './wordsWgsl.ts';

const PAGES = 2;

/** The words a whole upload sends for a table where the host maps entry 40 and a mover covered
 *  `unmapped` entries it does not map; `table` starts whole, as a burst leaves it. */
function wholeUpload(unmapped: number[]) {
  const fake = fakeDevice(),
    allocation = createShadowAllocationBuffers(fake.device, PAGES),
    table = createShadowTable(PAGES);
  table.write(40, 0 | PAGE_MAPPED | PAGE_VALID);
  for (const entry of unmapped) table.withdrawUnmapped(entry);
  const plan = { pool: { pages: PAGES, owner: Int32Array.of(40, -1) }, table } as never;
  const sent = allocation.writeWords(plan, 5, (sink) => table.flush(sink));
  const words = fake.writes.find((write) => write.buffer === allocation.words)!.data;
  const pairs = Array.from({ length: words[0] }, (_, i) => [
    words[WORDS_HEADER + 2 * i],
    words[WORDS_HEADER + 2 * i + 1],
  ]);
  return { sent, pairs, every: words[3] };
}

test('a whole upload keeps the withdraw marks of the entries only the GPU may have drawn', () => {
  const { pairs, every } = wholeUpload([41]);
  assert.deepEqual(pairs, [
    [40, 0 | PAGE_MAPPED | PAGE_VALID],
    [41, PAGE_WITHDRAWN],
  ]);
  assert.equal(every, 0);
});

test('past what the words hold, every page the GPU drew itself is withdrawn', () => {
  // Five words a pool page: the host's mapped page, then more marks than the rest holds.
  const { sent, pairs, every } = wholeUpload(Array.from({ length: 5 * PAGES }, (_, i) => 100 + i));
  assert.equal(pairs.length, 5 * PAGES);
  assert.equal(every, 1, 'the marks past the list: every GPU-only draw');
  assert.deepEqual(sent, { words: pairs.length, withdraw: PAGES }, 'the sweep, then the words');
  // Page 0 the GPU drew, page 1 the host: only the first loses its depth.
  const data = new Uint8Array(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    state = new Uint8Array((POOL_COUNTS.length + POOL_FIELDS.length * PAGES) * 4),
    table = new Uint32Array(data.buffer, SHADOW_TABLE_OFFSET),
    fields = new Int32Array(state.buffer, POOL_COUNTS.length * 4),
    at = (name: (typeof POOL_FIELDS)[number], page: number) =>
      POOL_FIELDS.indexOf(name) * PAGES + page;
  [fields[at('owner', 0)], fields[at('owner', 1)]] = [50, 51];
  [fields[at('drawnBy', 0)], fields[at('drawnBy', 1)]] = [DRAWN_GPU, DRAWN_HOST];
  table[50] = 0 | PAGE_MAPPED | PAGE_VALID;
  table[51] = 1 | PAGE_MAPPED | PAGE_VALID;
  const only = Uint32Array.of(0, PAGES, 5, 1);
  runShadowWords(data, state, new Uint8Array(only.buffer));
  assert.equal(table[50], 0 | PAGE_MAPPED, 'the GPU-only draw: read no more until drawn');
  assert.equal(fields[at('drawnBy', 0)], DRAWN_NONE);
  assert.equal(table[51], 1 | PAGE_MAPPED | PAGE_VALID, "the host's draw stands");
});

test('an unmapped entry goes out withdrawn once until a GPU page draw runs again', () => {
  const table = createShadowTable(PAGES),
    sent = () => {
      const out: number[] = [];
      table.eachWithdrawn((entry) => out.push(entry));
      table.flush(() => {});
      return out;
    };
  table.flush(() => {});
  table.withdrawUnmapped(41);
  assert.deepEqual(sent(), [41]);
  table.withdrawUnmapped(41);
  assert.deepEqual(sent(), [], 'no GPU draw since: the GPU holds none newer');
  table.gpuDrew();
  table.withdrawUnmapped(41);
  assert.deepEqual(sent(), [41], 'a GPU draw ran: withdrawn again');
});

// #831 review: the sweep and the words in one dispatch raced: a word landing a host draw on a page
// the GPU drew could be undone by another invocation's sweep. The sweep is its own entry point,
// dispatched before the words (`flushShadowTable`); the words' entry never sweeps.
test('the withdraw sweep is its own dispatch: the words entry never sweeps a page', () => {
  const wgsl = shadowWordsWgsl(),
    entry = (name: string) => wgsl.slice(wgsl.indexOf(`fn ${name}(`)).split('\n}')[0];
  assert.doesNotMatch(entry('applyShadowWords'), /withdrawGpuPage\(/);
  assert.match(entry('withdrawGpuPages'), /shadowWords\.every!=0u&&id\.x<shadowWords\.pages/);
});
