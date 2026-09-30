// A cut's tables past one binding split in parts bound at once (#974): every section of `flags`
// stays whole in one part, so the draw mask and the drawn log keep one buffer and one offset, and
// a host write lands in the part that holds each of its bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_SECTION,
  MASK_SECTION,
  flagLocation,
  flagPartWords,
  writeParts,
} from './split.ts';
import { dagFlagsWords } from './shader/lastUseWgsl.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { flagCuts, flagSectionStart, splitTable } from './splitFlags.ts';
import { FLAG_SECTIONS } from './flagSections.ts';

test('a table splits in parts of as many whole elements as one binding holds', () => {
  assert.deepEqual(splitTable(10, 48, 4096), { per: 10, parts: 1 }, 'whole: one part');
  assert.deepEqual(splitTable(200, 48, 4096), { per: 85, parts: 3 });
  assert.deepEqual(splitTable(3, 96, 64), { per: 1, parts: 3 }, 'one element past: refused later');
});

test("the sections are the kernel's: queue 0, four page sections, the queues, the last use", () => {
  const [queueCap, pageCount] = [7, 100];
  assert.equal(FLAG_SECTIONS, 1 + 4 + LEVEL_QUEUES);
  assert.equal(flagSectionStart(MASK_SECTION, queueCap, pageCount), queueCap, 'the draw mask');
  assert.equal(flagSectionStart(CANDIDATE_SECTION, queueCap, pageCount), queueCap + 3 * pageCount);
  assert.equal(
    flagSectionStart(FLAG_SECTIONS - 1, queueCap, pageCount),
    queueCap * LEVEL_QUEUES + 4 * pageCount,
    'the last use, behind the last queue (`lastUseAt`)',
  );
});

test('flags cut between whole sections, each part within the binding, all words kept', () => {
  const [queueCap, pageCount, cap] = [10, 1000, 4096];
  const cuts = flagCuts(queueCap, pageCount, cap);
  const words = dagFlagsWords(queueCap, pageCount);
  const parts = flagPartWords(cuts, queueCap, pageCount, words);
  assert.deepEqual(cuts, [2, 3, 4, 7]);
  assert.ok(parts.every((part) => part * 4 <= cap));
  assert.equal(
    parts.reduce((a, b) => a + b),
    words,
  );
  assert.deepEqual(flagCuts(queueCap, pageCount, words * 4), [], 'held whole: no cut');
  const mask = flagLocation(cuts, MASK_SECTION, queueCap, pageCount);
  assert.deepEqual(mask, { part: 0, word: queueCap }, 'the mask: one part, one offset');
  const log = flagLocation(cuts, CANDIDATE_SECTION, queueCap, pageCount);
  assert.deepEqual(log, { part: 3, word: 0 }, 'the drawn log: the start of its part');
});

test('a host write spanning two parts lands in each at its own offset', () => {
  const writes: [string, number, number, number][] = [];
  const device = {
    queue: {
      writeBuffer: (b: { name: string }, at: number, _d: unknown, from: number, size: number) =>
        writes.push([b.name, at, from, size]),
    },
  } as unknown as GPUDevice;
  const buffers = [{ name: 'a' }, { name: 'b' }] as unknown as GPUBuffer[];
  writeParts(device, { buffers, bytes: 64 }, 56, new ArrayBuffer(128), 56, 16);
  assert.deepEqual(writes, [
    ['a', 56, 56, 8],
    ['b', 0, 64, 8],
  ]);
});
