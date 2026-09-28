import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { STREAMING_FRAME_MS, STREAMING_SHARES_PER_FRAME } from '../../backend/common.ts';
import { createWebgpuResidencyQueue } from './queue.ts';
import { lruCache, pageOf, tierEnsurer } from './residentEnsurer.fixture.ts';
import { stubPage } from '../../world/render/frameQueue.fixture.ts';

/** A pool whose every load spends `cost` of the main-thread share (a whole one by default), on a
 *  clock the test owns. `perTask` counts the loads between two yields: each posts one message
 *  (`yieldToEventLoop`). */
function slowCache(slots: number, cost = STREAMING_FRAME_MS) {
  let clock = 0;
  mock.method(performance, 'now', () => clock);
  const yields = mock.method(MessagePort.prototype, 'postMessage');
  const cache = lruCache(slots),
    load = cache.load,
    order: string[] = [],
    perTask: number[] = [];
  cache.load = async (url: string) => {
    const task = yields.mock.callCount();
    perTask[task] = (perTask[task] ?? 0) + 1;
    clock += cost;
    order.push(url);
    await load(url);
  };
  return { cache, order, perTask };
}

/** Twelve pages the camera wants. */
function burst() {
  const pages = Array.from({ length: 12 }, (_, i) => pageOf(`p${i}`));
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  return { pages, tracking };
}

test('a barrier, which passes no camera probe, posts every caster before it resolves', async () => {
  const pages = ['sh0', 'sh1', 'sh2'].map(pageOf);
  const tracking = createWebgpuPageTracking(pages);
  try {
    const { cache } = slowCache(8);
    // A task queued before the job runs between two slices: the job yields to the event loop.
    let seen = -1;
    setImmediate(() => (seen = cache.resident.size));
    await tierEnsurer(tracking, cache, () => pages)([], 1, 1);
    assert.equal(cache.resident.size, 3, 'every caster posted when the job resolves');
    assert.ok(seen >= 1 && seen < 3, `the job yielded between slices (${seen} posted then)`);
  } finally {
    mock.restoreAll();
  }
});

test('a task starts no page past the published share', async () => {
  const { pages, tracking } = burst();
  const cost = STREAMING_FRAME_MS * 0.3;
  try {
    const { cache, perTask } = slowCache(16, cost);
    await tierEnsurer(tracking, cache, () => [])(pages, 1, 1);
    const tasks = perTask.filter(Boolean);
    assert.equal(cache.resident.size, 12, 'every page admitted');
    assert.ok(tasks.length > 1, `across several tasks (${tasks.join(' ')})`);
    // A page starts only within the share: the share's worth, and the one begun at its edge.
    for (const count of tasks) assert.ok(count <= Math.ceil(STREAMING_FRAME_MS / cost), `${count}`);
  } finally {
    mock.restoreAll();
  }
});

/** Runs a burst of twelve pages, each a whole share, firing a frame every `tasks` free tasks; the
 *  loads made between two frames. */
async function framedBurst(visibility: DocumentVisibilityState, tasks = 50) {
  const { pages, tracking } = burst();
  const host = stubPage(visibility),
    fire = () => {
      for (let due = host.frames.size; due > 0; due--) host.frames.run();
    };
  try {
    const { cache, order, perTask } = slowCache(16);
    let done = false;
    const job = tierEnsurer(tracking, cache, () => [])(pages, 1, 1).then(() => (done = true));
    const perFrame: number[] = [];
    for (let last = 0; !done && perFrame.length < 100; last = order.length, fire()) {
      for (let task = 0; task < tasks && !done; task++) await new Promise(setImmediate);
      perFrame.push(order.length - last);
    }
    await job;
    assert.equal(cache.resident.size, 12, 'every page admitted');
    return { perFrame, perTask: perTask.filter(Boolean), asked: host.frames.size };
  } finally {
    host.restore();
    mock.restoreAll();
  }
}

test('a visible page opens a bounded number of shares between two frames (#983)', async () => {
  const { perFrame } = await framedBurst('visible');
  // The shares the pace opens, and the piece begun before the first.
  for (const loads of perFrame) assert.ok(loads <= STREAMING_SHARES_PER_FRAME + 1, `${perFrame}`);
  assert.ok(perFrame.length > 1, 'the burst spread over frames');
});

test('a hidden page never waits for a frame: a share per task, as before (#983)', async () => {
  const { perFrame, perTask, asked } = await framedBurst('hidden');
  assert.deepEqual(perFrame, [12], 'the whole burst loaded with no frame');
  assert.deepEqual(perTask, new Array(12).fill(1), 'a whole share per task, no task lost');
  assert.equal(asked, 0, 'no frame asked');
});

test('a camera cut queued during a long caster load is served before the tier ends', async () => {
  const casters = ['sh0', 'sh1', 'sh2', 'sh3', 'sh4', 'sh5'].map(pageOf),
    camera = pageOf('cam');
  const tracking = createWebgpuPageTracking([...casters, camera]);
  try {
    const { cache, order } = slowCache(8);
    const queue = createWebgpuResidencyQueue({
      tracking,
      sets: { applyBudget() {}, decideBy() {} } as never,
      room: () => 8,
      getCache: () => cache as never,
      getFrame: () => 0,
      updatePins() {},
      closure: {} as never,
      ensureResident: tierEnsurer(tracking, cache, () => casters),
      markLost() {},
      traceEnabled: false,
      traceDiagnostic: () => {},
      diagnosticFailure: () => {},
    });
    queue.queueCutResidency(false);
    // The camera moves while the tier loads: its cut queues a page behind the running job.
    setImmediate(() => {
      tracking.wanted.add(tracking.keyOf(camera), camera);
      queue.queueCutResidency(false);
    });
    await queue.pending;
    assert.ok(
      order.indexOf('cam') < order.indexOf('sh5'),
      `the camera page came before the last caster (${order.join(' ')})`,
    );
    assert.equal(cache.resident.size, 7, 'and the job ended with every caster posted');
  } finally {
    mock.restoreAll();
  }
});

// A report taken while the tier loads rewrites its list in place: the load keeps the list it began
// with, so which casters end resident depends on no timing.
test('the tier loads the list it began with, whatever a report rewrites meanwhile', async () => {
  const pages = ['a', 'b', 'c', 'd'].map(pageOf);
  const [a, b, c, d] = pages;
  const tracking = createWebgpuPageTracking(pages);
  const cache = lruCache(3),
    load = cache.load;
  const live = [a, b, c, d];
  cache.load = async (url: string) => {
    await load(url);
    live.splice(0, live.length, a, d, b, c);
  };
  await tierEnsurer(tracking, cache, () => live)([], 1, 1);
  assert.deepEqual([...cache.resident.keys()].sort(), ['a', 'b', 'c']);
});
