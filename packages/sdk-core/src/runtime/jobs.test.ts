import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createJob } from './jobs.ts';

/** A job whose work aborts `controller` before returning `value`: cancellation wins the race. */
const lateCancel = <T>(value: T, options: { disposeResult?: (result: T) => void } = {}) => {
  const controller = new AbortController();
  return createJob(
    'late',
    async () => {
      controller.abort('late abort');
      return value;
    },
    { signal: controller.signal, ...options },
  );
};

/** Work that waits until the test lets it go. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

test('Job snapshots expose actual progress and completion; observer failures cannot corrupt work', async () => {
  const statuses: string[] = [];
  const job = createJob(
    'test',
    async ({ progress }) => {
      progress({ phase: 'read', completed: 1, total: 1 });
      return 42;
    },
    {
      telemetry: (s) => {
        statuses.push(s.status);
        throw new Error('observer');
      },
    },
  );
  const initial = job.getSnapshot();
  assert.equal(initial, job.getSnapshot());
  job.subscribe(() => assert.fail('observer'));
  assert.equal(await job.promise, 42);
  assert.equal(job.getSnapshot().status, 'completed');
  assert.equal(job.getSnapshot().result, 42);
  assert.deepEqual(statuses, ['running', 'running', 'completed']);
  assert.notEqual(initial, job.getSnapshot());
});

test('subscribers see frozen progress snapshots, unsubscribe, and receive the completed value', async () => {
  const observed: unknown[] = [];
  const work = deferred<string>();
  const job = createJob('asset-7', async ({ progress }) => {
    progress({ phase: 'parse', completed: 2, total: 3 });
    return work.promise;
  });
  assert.deepEqual(job.getSnapshot(), {
    eventVersion: 1,
    id: 'asset-7',
    status: 'queued',
    progress: null,
    result: null,
    error: null,
  });
  const unsubscribe = job.subscribe(() => {
    const snapshot = job.getSnapshot();
    assert.ok(Object.isFrozen(snapshot));
    observed.push(snapshot);
  });
  await Promise.resolve();
  assert.equal(observed.length, 2);
  assert.equal(job.getSnapshot().status, 'running');
  assert.deepEqual(job.getSnapshot().progress, { phase: 'parse', completed: 2, total: 3 });
  unsubscribe();
  work.resolve('compiled');
  assert.equal(await job.promise, 'compiled');
  assert.equal(observed.length, 2);
  assert.deepEqual(job.getSnapshot(), {
    eventVersion: 1,
    id: 'asset-7',
    status: 'completed',
    progress: { phase: 'parse', completed: 2, total: 3 },
    result: 'compiled',
    error: null,
  });
});

test('a work error remains the promise rejection and appears in the failed snapshot', async () => {
  const failure = new Error('cannot parse this asset');
  const job = createJob('bad-asset', async () => {
    throw failure;
  });
  await assert.rejects(job.promise, (error) => error === failure);
  assert.deepEqual(job.getSnapshot(), {
    eventVersion: 1,
    id: 'bad-asset',
    status: 'failed',
    progress: null,
    result: null,
    error: { code: 'JOB_FAILED', message: String(failure) },
  });
});

test('Pre-cancelled jobs do not begin work', async () => {
  let called = false;
  const job = createJob('cancel', async () => (called = true), { signal: AbortSignal.abort() });
  await assert.rejects(job.promise);
  assert.equal(called, false);
  assert.equal(job.getSnapshot().status, 'cancelled');
  assert.equal(job.getSnapshot().error?.code, 'CANCELLED');
});

test('cancel relays the caller reason and prevents later progress from publishing', async () => {
  const work = deferred<void>();
  let aborted: unknown;
  const job = createJob('cancel-midway', async ({ signal, progress }) => {
    signal.addEventListener('abort', () => {
      aborted = signal.reason;
    });
    await work.promise;
    progress({ phase: 'must-not-publish' });
    return 'unreachable';
  });
  await Promise.resolve();
  job.cancel('host cancelled');
  assert.equal(aborted, 'host cancelled');
  work.resolve();
  await assert.rejects(job.promise, (error) => error === 'host cancelled');
  assert.equal(job.getSnapshot().status, 'cancelled');
  assert.equal(job.getSnapshot().progress, null);
  assert.deepEqual(job.getSnapshot().error, { code: 'CANCELLED', message: 'host cancelled' });
});

test('a result returned after cancellation is disposed, and a failing cleanup keeps the job cancelled', async () => {
  const disposed: string[] = [];
  const hooked: unknown[] = [];
  const value = {
    dispose() {
      disposed.push('result');
      throw new Error('dispose failed');
    },
  };
  const job = lateCancel(value, {
    disposeResult(result) {
      hooked.push(result);
      throw new Error('host hook failed');
    },
  });
  await assert.rejects(job.promise, (error) => error === 'late abort');
  assert.deepEqual(disposed, ['result']);
  assert.deepEqual(hooked, [value]);
  assert.equal(job.getSnapshot().status, 'cancelled');
  assert.equal(job.getSnapshot().result, null);
  const none = lateCancel<unknown>(undefined, { disposeResult: (result) => hooked.push(result) });
  await assert.rejects(none.promise);
  assert.deepEqual(hooked, [value], 'work cancelled before any result disposes nothing');
});

test('Completed jobs keep ownership of a disposable result', async () => {
  let disposed = false;
  const job = createJob('keep', async () => ({ dispose: () => (disposed = true) }));
  await job.promise;
  assert.equal(disposed, false);
  assert.equal(job.getSnapshot().status, 'completed');
});

test('the external signal is held from the start and released however the job ends', async () => {
  // `edited`: the caller removes the signal from its options object while the job runs.
  for (const end of ['complete', 'fail', 'cancel', 'edited'] as const) {
    const controller = new AbortController();
    const options: { signal?: AbortSignal } = { signal: controller.signal };
    const work = deferred<void>();
    const job = createJob(
      end,
      async () => {
        await work.promise;
        if (end === 'fail') throw new Error('failure');
        return 5;
      },
      options,
    );
    await Promise.resolve();
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
    if (end === 'edited') delete options.signal;
    if (end === 'cancel' || end === 'edited') controller.abort(end);
    work.resolve();
    if (end === 'complete') assert.equal(await job.promise, 5);
    else if (end === 'fail') await assert.rejects(job.promise, /failure/);
    else await assert.rejects(job.promise, (error) => error === end);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    const terminal = job.getSnapshot();
    controller.abort();
    assert.equal(job.getSnapshot(), terminal);
  }
});
