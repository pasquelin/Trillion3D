// CPU-15: the root and mark words `parkWorld` and `markWorld` write go up as one interval per
// cut, not one write each. Against develop's word-by-word writes, on random sequences and the edge
// values: every word the host owns in each range's buffer ends identical, and the flush sends one
// write per range the interval crosses, none when nothing was written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDagResources } from './resources.ts';
import { packDagSelection } from './selection.ts';
import { framesBytes } from './frameRanges.ts';
import { primitiveWordAt } from './worlds.ts';
import { FRAME_VEC4 } from './types.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { packed } from './selectionHelpers.fixture.ts';
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';
import { seeded } from '../../host/world/randomTree.fixture.ts';

const COUNT = 48,
  PER = 20,
  ROW_FLOATS = FRAME_VEC4 * 4;
const VALUES = [...HOSTILE_FLOATS, 0xffffffff, 0x7fffffff, 1, 2 ** 32, -1];

/** Forty-eight primitives over three ranges of twenty, twenty and eight. */
async function frames() {
  const [root] = packed(dagFixture()).roots;
  const dag = packDagSelection(Array.from({ length: COUNT }, () => root));
  const limits = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: framesBytes(PER) };
  const fake = fakeDevice({ limits: { ...limits, minUniformBufferOffsetAlignment: 256 } });
  const resources = await createDagResources(fake.device, dag, false);
  assert.ok(resources);
  return { fake, frames: resources.frames };
}

/** Each range's buffer as its writes left it, then the writes forgotten. */
function replayed({ fake, frames: f }: Awaited<ReturnType<typeof frames>>) {
  return f.buffers.map((buffer) => {
    const bytes = new ArrayBuffer(buffer.size);
    replayWrites(
      bytes,
      fake.writes.filter((w) => w.buffer === buffer),
    );
    return new Uint32Array(bytes);
  });
}

/** Develop's word: written into its range at once, one write each. */
function wordNow(buffers: Uint32Array[], w: number, slot: number, value: number) {
  const r = Math.floor(w / PER),
    held = new Uint32Array([value]);
  buffers[r][primitiveWordAt(w) - r * PER * ROW_FLOATS + slot] = held[0];
}

/** The four frame words of every primitive, in each range: what the host owns there. */
function hostWords(buffers: Uint32Array[]) {
  const out: number[] = [];
  for (let w = 0; w < COUNT; w++) {
    const r = Math.floor(w / PER),
      at = primitiveWordAt(w) - r * PER * ROW_FLOATS;
    out.push(...buffers[r].subarray(at, at + 4));
  }
  return out;
}

async function run(writes: [number, number, number][]) {
  const cut = await frames();
  const reference = replayed(await frames());
  const opened = cut.fake.writes.length;
  for (const [w, slot, value] of writes) {
    cut.frames.writeWord(w, slot, value);
    wordNow(reference, w, slot, value);
  }
  assert.equal(cut.fake.writes.length, opened, 'nothing sent before the flush');
  cut.frames.flushWords();
  const ranges = writes.map(([w]) => Math.floor(w / PER));
  const crossed = writes.length ? Math.max(...ranges) - Math.min(...ranges) + 1 : 0;
  assert.equal(
    cut.fake.writes.length - opened,
    crossed,
    'one write per range the interval crosses',
  );
  cut.frames.flushWords();
  assert.equal(cut.fake.writes.length - opened, crossed, 'a second flush sends nothing');
  assert.deepEqual(hostWords(replayed(cut)), hostWords(reference));
}

test('parked and marked words go up as one interval, equal to word-by-word writes', async () => {
  const draw = seeded(972);
  for (let round = 0; round < 40; round++) {
    const n = Math.floor(draw() * 12);
    const writes = Array.from({ length: n }, (): [number, number, number] => [
      Math.floor(draw() * COUNT),
      draw() < 0.5 ? 1 : 3,
      draw() < 0.3 ? VALUES[Math.floor(draw() * VALUES.length)] : Math.floor(draw() * 2 ** 32),
    ]);
    await run(writes);
  }
});

test('edge cases: nothing written, one word, the same word twice, every word of every range', async () => {
  await run([]);
  await run([[25, 1, 7]]);
  await run([
    [3, 3, 1],
    [3, 3, 0],
  ]);
  const every: [number, number, number][] = [];
  for (let w = 0; w < COUNT; w++) every.push([w, 1, w], [w, 3, 0xffffffff - w]);
  await run(every);
});
