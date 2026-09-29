import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebglFrameTimer, WHOLE_FRAME_PASS } from './frameTimer.ts';

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT_AVAILABLE = 0x8867;
const QUERY_RESULT = 0x8866;

/** Fake WebGL2RenderingContext: one query = an id, a result and a ready flag. */
function fakeGl(options: { withExtension?: boolean } = {}) {
  const { withExtension = true } = options;
  const results = new Map<number, number>();
  const available = new Set<number>();
  const deleted: number[] = [];
  let created = 0,
    disjoint = false,
    flushes = 0;
  const gl = {
    getExtension: (name: string) =>
      withExtension && name === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
        : null,
    createQuery: () => ({ id: created++ }),
    beginQuery() {},
    endQuery() {},
    flush() {
      flushes++;
    },
    getQueryParameter: (query: { id: number }, pname: number) =>
      pname === QUERY_RESULT_AVAILABLE ? available.has(query.id) : results.get(query.id),
    getParameter: () => disjoint,
    deleteQuery: (query: { id: number }) => deleted.push(query.id),
    QUERY_RESULT_AVAILABLE,
    QUERY_RESULT,
  } as unknown as WebGL2RenderingContext;
  return {
    gl,
    setDisjoint: (value: boolean) => (disjoint = value),
    markAvailable: (id: number, nanoseconds: number) => {
      available.add(id);
      results.set(id, nanoseconds);
    },
    created: () => created,
    deleted,
    flushes: () => flushes,
  };
}

test('without the extension, the timer reports unsupported and nothing is ever measured', () => {
  const timer = createWebglFrameTimer(fakeGl({ withExtension: false }).gl);
  assert.equal(timer.supported, false);
  timer.begin(0);
  timer.pass('any');
  timer.end();
  const polled = timer.poll();
  assert.equal(polled.ms, null);
  assert.equal(polled.reason, 'EXT_disjoint_timer_query_webgl2 missing on this device');
});

test('with no pending query, poll explains the absence rather than returning zero', () => {
  const timer = createWebglFrameTimer(fakeGl().gl);
  assert.deepEqual(timer.poll(), {
    ms: null,
    reason: 'no pending query',
    frame: null,
    passes: [],
    truncated: false,
  });
});

test('a query that is not ready yet stays unmeasured, without being lost', () => {
  const f = fakeGl();
  const timer = createWebglFrameTimer(f.gl);
  timer.begin(0);
  timer.end();
  assert.equal(timer.poll().reason, 'result not ready yet');
  assert.equal(f.flushes(), 1);
});

test('a frame that names no pass keeps one whole-frame interval', () => {
  const f = fakeGl();
  const timer = createWebglFrameTimer(f.gl);
  timer.begin(7);
  timer.end({ scale: 0.5, steered: true });
  f.markAvailable(0, 2_500_000);
  assert.deepEqual(timer.poll(), {
    ms: 2.5,
    reason: null,
    frame: 7,
    passes: [{ name: WHOLE_FRAME_PASS, ms: 2.5 }],
    truncated: false,
    tag: { scale: 0.5, steered: true },
  });
  assert.deepEqual(f.deleted, [0]);
});

test('each contiguous pass is timed on its own, in order, and the image sums them', () => {
  const f = fakeGl();
  const timer = createWebglFrameTimer(f.gl);
  timer.begin(3);
  timer.pass('capture');
  timer.pass('opaque');
  timer.pass('transmission');
  timer.end();
  // The interval opened at `begin` carries the first pass; the next three open their own.
  assert.equal(f.created(), 3);
  f.markAvailable(0, 1_000_000);
  f.markAvailable(1, 4_000_000);
  f.markAvailable(2, 500_000);
  const read = timer.poll();
  assert.equal(read.ms, 5.5, 'the image is the sum of its passes');
  assert.deepEqual(read.passes, [
    { name: 'capture', ms: 1 },
    { name: 'opaque', ms: 4 },
    { name: 'transmission', ms: 0.5 },
  ]);
});

test('a disjoint query is dropped with its reason, never published as a duration', () => {
  const f = fakeGl();
  f.setDisjoint(true);
  const timer = createWebglFrameTimer(f.gl);
  timer.begin(0);
  timer.pass('opaque');
  timer.end();
  f.markAvailable(0, 1_000_000);
  assert.deepEqual(timer.poll(), {
    ms: null,
    reason: 'the driver interrupted the measurement (GPU_DISJOINT_EXT)',
    frame: null,
    passes: [],
    truncated: false,
  });
});

test('beyond the pending-query threshold, no further frame is opened', () => {
  const f = fakeGl();
  const timer = createWebglFrameTimer(f.gl);
  for (let i = 0; i < 6; i++) {
    timer.begin(0);
    timer.end();
  }
  // MAX_PENDING = 4: four frames stay in flight, the fifth and sixth open nothing.
  assert.equal(f.created(), 4);
});
