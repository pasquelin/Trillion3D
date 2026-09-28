// The threaded physics worker's start (#985): a worker a worker starts loads only while its parent's
// event loop turns, and a threaded step blocks on its pool's jobs, so a step issued before every
// pool thread has loaded could wait for good. Nothing steps, and `ready` is not sent, until each
// thread has reported loaded; a thread that fails to load stops the start, named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate, setTimeout } from 'node:timers/promises';
import type { Worker as NodeWorker } from 'node:worker_threads';
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { JOLT_THREAD_LOADED, type JoltThreadStart } from './joltThreads.ts';
import { nodeThread } from './module.fixture.ts';
import { fakeWorkers, launchedWorker } from './worker.fixture.ts';

const THREADS = 4;

/** Pool threads faked in place of `Worker`: each runs its thread for real (a Node worker) but
 *  reports loaded (`onmessage`), or fails (`onerror`), only when the test says. */
function heldThreads() {
  const running: NodeWorker[] = [];
  const { workers, restore } = fakeWorkers((start) =>
    running.push(nodeThread(start as JoltThreadStart)),
  );
  const close = () => (restore(), Promise.all(running.map((thread) => thread.terminate())));
  return { held: workers, close };
}

/** Turns the event loop until `done` holds (the module compiles meanwhile), 30 s at most. */
async function until(done: () => boolean) {
  for (const end = Date.now() + 30_000; !done(); await setTimeout(1))
    assert.ok(Date.now() < end, 'the worker spawned its pool threads');
}

test('a threaded worker steps only once every pool thread has loaded', async (t) => {
  const { held, close } = heldThreads();
  t.after(close);
  let now = 0;
  const { ticks, sent, receive, ready } = await launchedWorker(() => now, THREADS);
  await until(() => held.length === THREADS - 1);
  // Turns enough for a start that does not wait to post its ready and schedule its first step.
  for (let turn = 0; turn < 20; turn++) await setImmediate();
  // The module is started and its threads spawned, not loaded: the first step waits for them.
  assert.deepEqual(sent, [], 'no ready and no step before the threads loaded');
  assert.equal(ticks.length, 0, 'no tick owed before the threads loaded');
  for (const thread of held) thread.onmessage({ data: JOLT_THREAD_LOADED });
  await ready;
  ticks.shift()![0](); // At start, nothing owed yet.
  receive({ type: 'commands', words: new Uint32Array(0) });
  now += 2 * PHYSICS_STEP * 1000 + 1;
  ticks.shift()![0]();
  const results = sent.filter((m) => m.type === 'results');
  assert.ok(
    results.some((m) => m.steps > 0),
    'the pool steps once loaded',
  );
  assert.ok(!sent.some((m) => m.type === 'error'), JSON.stringify(sent));
  // A loaded thread that throws is named to the page, not dropped.
  held[2].onerror({ message: 'out of stack' });
  assert.deepEqual(sent.at(-1), {
    type: 'error',
    code: 'PHYSICS_FAILED',
    message: 'Physics: pool thread 3 failed: out of stack',
    fatal: true,
  });
});

test('a pool thread that fails to load stops the start, named', async (t) => {
  const { held, close } = heldThreads();
  t.after(close);
  const { sent } = await launchedWorker(() => 0, THREADS);
  await until(() => held.length === THREADS - 1);
  held[0].onmessage({ data: JOLT_THREAD_LOADED });
  held[1].onerror({ message: 'its script failed to parse' });
  await until(() => sent.length > 0);
  assert.deepEqual(sent, [
    {
      type: 'error',
      code: 'PHYSICS_FAILED',
      message: 'Physics: pool thread 2 did not load: its script failed to parse',
      fatal: true,
    },
  ]);
});
