// The physical page lists' appends run in the single-group kernels they follow
// (`physicalPagesWgsl.ts`): the empty pages after the compacted available ones, and, after the
// feedback, the available pages after the requested ones. Each leaves the lists the copy dispatch
// and its one-group count dispatch left: the input's items after the output's, order kept, never
// past the pool, then the output's count raised and the input's cleared — the counts written by
// lane 0 once every lane read them (the barrier: here lane 0 runs last), and the feedback reading
// the available count before the append clears it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../texture/shaderRule.fixture.ts';
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts';
import { vsmLayout } from './resources.ts';
import { seeded } from './planFrames.fixture.ts';

const KERNELS = vsmPhysicalPageKernels(vsmLayout({ fullMapCapacity: 7 }, 2 ** 27));
const LISTS = ['pmListStart', 'pmListItem', 'pmSetListItem', 'pmListCount', 'pmSetListCount'];

/** Lists of `n` pages: each list's items then its count (`pmListStart`). */
function listsOf(n: number, counts: number[], rand: () => number) {
  const words = new Array<number>(counts.length * (n + 1)).fill(-7);
  counts.forEach((count, list) => {
    for (let i = 0; i < count; i++) words[list * (n + 1) + i] = Math.floor(rand() * n);
    words[list * (n + 1) + n] = count;
  });
  return words;
}
/** The lists the copy and count dispatches left: `from` after `to`, at most `n` items. */
function appended(words: number[], n: number, from: number, to: number) {
  const out = words.slice(),
    at = (list: number) => list * (n + 1);
  const outputCount = words[at(to) + n],
    copy = Math.max(0, Math.min(words[at(from) + n], n - outputCount));
  for (let t = 0; t < copy; t++) out[at(to) + outputCount + t] = words[at(from) + t];
  out[at(to) + n] = outputCount + copy;
  out[at(from) + n] = 0;
  return out;
}

test('after the feedback, the available pages go after the requested ones, as the dispatches did', () => {
  const code = KERNELS.poolFeedback.code,
    C = wgslConstants(code);
  const rand = seeded(11);
  for (const n of [600, 300, 2048]) {
    for (let round = 0; round < 12; round++) {
      const counts = [0, 0, 0, 0].map(() => Math.floor(rand() * (n + 1)));
      const words = listsOf(n, counts, rand);
      const expected = appended(words, n, C.VSM_PAGES_FREE, C.VSM_PAGES_REQUESTED);
      const feedback: number[] = [];
      const { vsmPoolFeedback } = shaderRun<{ vsmPoolFeedback: (lane: number) => void }>(
        code,
        ['vsmPoolFeedback', 'pmAppendList', ...LISTS],
        {
          ...C,
          vsm: { poolPages: n, pressureBias: 0, frameStamp: 9 },
          vsmPoolLists: words,
          vsmFeedbackStore: (i: number, v: number) => void (feedback[i] = v),
          // The count's bits as a word: an i32's, not a float's (shaderRun's bitcast reads floats).
          bitcast_u32: (x: number) => x >>> 0,
          storageBarrier() {},
        },
      );
      for (let lane = 255; lane >= 0; lane--) vsmPoolFeedback(lane);
      assert.deepEqual(words, expected, `${n} pages, round ${round}`);
      assert.equal(feedback[1], counts[C.VSM_PAGES_FREE], 'the count before the append');
    }
  }
});

test('the empty pages go after the compacted available ones, as the dispatches did', () => {
  const code = KERNELS.packFreePages.code,
    C = wgslConstants(code);
  const rand = seeded(12);
  for (const n of [600, 2048]) {
    for (let round = 0; round < 12; round++) {
      const counts = [0, 0, 0, 0].map(() => Math.floor(rand() * (n + 1)));
      const words = listsOf(n, counts, rand);
      const total = counts[C.VSM_PAGES_FREE];
      const expected = appended(words, n, C.VSM_PAGES_EMPTY, C.VSM_PAGES_FREE);
      const { pmAppendList } = shaderRun<{
        pmAppendList: (from: number, to: number, count: number, lane: number) => void;
      }>(code, ['pmAppendList', ...LISTS], {
        ...C,
        vsm: { poolPages: n },
        vsmPoolLists: words,
        storageBarrier() {},
      });
      for (let lane = 255; lane >= 0; lane--)
        pmAppendList(C.VSM_PAGES_EMPTY, C.VSM_PAGES_FREE, total, lane);
      assert.deepEqual(words, expected, `${n} pages, round ${round}`);
    }
  }
  // The compaction hands its own count on, every lane's: the append writes the list's count.
  assert.match(code, /pmAppendList\(VSM_PAGES_EMPTY,VSM_PAGES_FREE,totalCount,groupIndex\);\n\}/);
  assert.doesNotMatch(code, /pmSetListCount\(VSM_PAGES_FREE,totalCount\)/);
});
