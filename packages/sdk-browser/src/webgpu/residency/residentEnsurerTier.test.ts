import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { STREAMING_FRAME_MS } from '../../backend/common.ts';
import { createWebgpuResidencyQueue } from './queue.ts';
import { lruCache, pageOf, tierEnsurer } from './residentEnsurer.fixture.ts';

/** A pool whose every load spends a whole main-thread share, on a clock the test owns. */
function slowCache(slots: number) {
  let clock = 0;
  mock.method(performance, 'now', () => clock);
  const cache = lruCache(slots),
    load = cache.load,
    order: string[] = [];
  cache.load = async (url: string) => {
    clock += STREAMING_FRAME_MS;
    order.push(url);
    await load(url);
  };
  return { cache, order };
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
  const pages = Array.from({ length: 12 }, (_, i) => pageOf(`p${i}`));
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  let clock = 0;
  mock.method(performance, 'now', () => clock);
  // Each yield posts one message (`yieldToEventLoop`): the pages loaded between two are one task's.
  const yields = mock.method(MessagePort.prototype, 'postMessage');
  const cost = STREAMING_FRAME_MS * 0.3,
    perTask: number[] = [];
  const cache = lruCache(16),
    load = cache.load;
  cache.load = async (url: string) => {
    const task = yields.mock.callCount();
    perTask[task] = (perTask[task] ?? 0) + 1;
    clock += cost;
    await load(url);
  };
  try {
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

test('a hidden tab, where no frame comes, loads a whole burst, a share per task', async () => {
  const pages = Array.from({ length: 12 }, (_, i) => pageOf(`p${i}`));
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  const frames = globalThis as { requestAnimationFrame?: unknown };
  frames.requestAnimationFrame = () => 0;
  try {
    // Every load spends a whole share: twelve shares, and not one frame to spend them in.
    const { cache } = slowCache(16);
    let done = false;
    const job = tierEnsurer(tracking, cache, () => [])(pages, 1, 1).then(() => (done = true));
    let tasks = 0;
    for (; !done && tasks < pages.length * 4; tasks++) await new Promise(setImmediate);
    assert.ok(done, `the burst resolved without a frame (${cache.resident.size} of 12 loaded)`);
    await job;
    assert.equal(cache.resident.size, 12);
    assert.ok(tasks > 1, 'yielding between shares');
  } finally {
    delete frames.requestAnimationFrame;
    mock.restoreAll();
  }
});

test('a camera cut queued during a long caster load is served before the tier ends', async () => {
  const casters = ['sh0', 'sh1', 'sh2', 'sh3', 'sh4', 'sh5'].map(pageOf),
    camera = pageOf('cam');
  const tracking = createWebgpuPageTracking([...casters, camera]);
  try {
    const { cache, order } = slowCache(8);
    const queue = createWebgpuResidencyQueue({
      tracking,
      sets: { applyBudget() {} } as never,
      room: () => 8,
      getCache: () => cache as never,
      getFrame: () => 0,
      updatePins() {},
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
