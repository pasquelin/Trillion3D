// #1369: a moving image's shadow read takes `MOVING_PCF_TAPS` of the sixteen taps, one in four from
// the image's rank (`shadowTapsOf`), through the shipped `shadowPcf` run in JavaScript: the pages it
// asks for are the still read's, its comparisons those of its taps alone, and the four phases of the
// rank average to the still read's answer — the history converges to it. A still image reads all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { hash } from './shadowPages.fixture.ts';
import { MOVING_PCF_TAPS } from './pcfTaps.ts';
import { SHADOW_WGSL } from './sunRangeRead.fixture.ts';
import { PAGE, PCF_TAPS, TAPS, TURN, coordinate, pcfRun, type V } from './shadowPcfRun.fixture.ts';

const STRIDE = PCF_TAPS / MOVING_PCF_TAPS;
const { shadowTapsOf } = shaderRun<{ shadowTapsOf: (rank: number) => V }>(
  SHADOW_WGSL,
  ['shadowTapsOf'],
  {},
);

test('a still image reads every tap; a moving one one in four, turning with its rank', () => {
  assert.deepEqual([...shadowTapsOf(0)], [0, 1]);
  for (const rank of [1, 2, 3, 4, 5, 1024])
    assert.deepEqual([...shadowTapsOf(rank)], [rank % STRIDE, STRIDE]);
});

test('four moving phases ask the same pages and average to the still read (#1369)', () => {
  const r = mulberry32(1369);
  for (let i = 0; i < 2000; i++) {
    const lamp = i % 2 === 0,
      pages = 1 + Math.floor(r() * 8),
      home = [0, 1].map(() => (lamp ? Math.floor(r() * pages) : Math.floor(r() * 17) - 8)),
      t = home.map((p) => coordinate(r, p)),
      side = lamp ? pages * PAGE : 0,
      reference = r() * 1.2 - 0.1,
      seed = Math.floor(r() * 2 ** 31),
      readable = (p: V) => hash(seed ^ Math.imul(p[0], 7919) ^ Math.imul(p[1], 104729)) < 0.5,
      angle = r() * 2 * Math.PI;
    TURN.splice(0, 2, Math.cos(angle), Math.sin(angle));
    const run = (taps: V) => {
      TAPS.splice(0, 2, ...taps);
      return pcfRun(readable, {}, t, reference, home, 0x80000000, side, true);
    };
    const still = run([0, 1]);
    let mean = 0;
    for (let rank = 1; rank <= STRIDE; rank++) {
      const moving = run([...shadowTapsOf(rank)]);
      assert.deepEqual(moving.calls.neighbour, still.calls.neighbour, 'the same pages asked for');
      const reads = (c: typeof still.calls) => c.sample.length + c.compare.length;
      assert.equal(reads(moving.calls) * STRIDE, reads(still.calls), 'one comparison in four');
      mean += moving.answer / STRIDE;
    }
    assert.ok(Math.abs(mean - still.answer) < 1e-12, `t ${t}: ${mean} against ${still.answer}`);
  }
  TAPS.splice(0, 2, 0, 1);
});
