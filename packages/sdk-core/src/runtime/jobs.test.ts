import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createJob } from './jobs.ts';

/** A job whose work aborts `controller` before returning `value`: cancellation wins the race. */
const lateCancel = <T>(
  value: T,
  options: { disposeResult?: (result: T) => void } = {},
  reason: unknown = 'late abort',
) => {
  const controller = new AbortController();
  return createJob(
    'late',
    async () => {
      controller.abort(reason);
      return value;
    },
    { signal: controller.signal, ...options },
  );
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
  job.subscribe(() => {
    throw new Error('observer');
  });
  assert.equal(await job.promise, 42);
  assert.equal(job.getSnapshot().status, 'completed');
  assert.equal(job.getSnapshot().result, 42);
  assert.deepEqual(statuses, ['running', 'running', 'completed']);
  assert.notEqual(initial, job.getSnapshot());
});

test('subscribers see frozen progress snapshots, unsubscribe, and receive the completed value', async () => {
  const observed: unknown[] = [];
  let resolveWork!: (value: string) => void;
  const job = createJob('asset-7', async ({ progress }) => {
    progress({ phase: 'parse', completed: 2, total: 3 });
    return new Promise<string>((resolve) => {
      resolveWork = resolve;
    });
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
  resolveWork('compiled');
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
  const job = createJob(
    'cancel',
    async () => {
      called = true;
      return 1;
    },
    { signal: AbortSignal.abort() },
  );
  await assert.rejects(job.promise);
  assert.equal(called, false);
  assert.equal(job.getSnapshot().status, 'cancelled');
  assert.equal(job.getSnapshot().error?.code, 'CANCELLED');
});

test('cancel relays the caller reason and prevents later progress from publishing', async () => {
  let continueWork!: () => void;
  let aborted: unknown;
  const job = createJob('cancel-midway', async ({ signal, progress }) => {
    signal.addEventListener('abort', () => {
      aborted = signal.reason;
    });
    await new Promise<void>((resolve) => {
      continueWork = resolve;
    });
    progress({ phase: 'must-not-publish' });
    return 'unreachable';
  });
  await Promise.resolve();
  job.cancel('host cancelled');
  assert.equal(aborted, 'host cancelled');
  continueWork();
  await assert.rejects(job.promise, (error) => error === 'host cancelled');
  assert.equal(job.getSnapshot().status, 'cancelled');
  assert.equal(job.getSnapshot().progress, null);
  assert.deepEqual(job.getSnapshot().error, { code: 'CANCELLED', message: 'host cancelled' });
});

test('Cancel after work returns disposes a result that never reached completed', async () => {
  let disposed = false;
  const job = lateCancel({
    dispose() {
      disposed = true;
    },
  });
  await assert.rejects(job.promise);
  assert.equal(disposed, true);
  assert.equal(job.getSnapshot().status, 'cancelled');
  assert.equal(job.getSnapshot().result, null);
});

test('Completed jobs keep ownership of a disposable result', async () => {
  let disposed = false;
  const job = createJob('keep', async () => ({
    dispose() {
      disposed = true;
    },
  }));
  const result = await job.promise;
  assert.equal(disposed, false);
  assert.equal(job.getSnapshot().status, 'completed');
  result.dispose();
  assert.equal(disposed, true);
});

test('late cancellation disposes only owned results and calls the host hook even after disposal throws', async () => {
  for (const value of [
    null,
    0,
    'value',
    {},
    { dispose: 7 },
    {
      dispose() {
        throw new Error('dispose failed');
      },
    },
  ]) {
    const hooked: unknown[] = [];
    const job = lateCancel(value, {
      disposeResult(result) {
        hooked.push(result);
        throw new Error('host hook failed');
      },
    });
    await assert.rejects(job.promise, (error) => error === 'late abort');
    assert.deepEqual(hooked, [value]);
    assert.equal(job.getSnapshot().status, 'cancelled');
    assert.equal(job.getSnapshot().result, null);
  }
});

test('a cancelled callable result with a disposer is disposed like any other owned result', async () => {
  let disposed = false;
  const value = Object.assign(() => 42, {
    dispose: () => {
      disposed = true;
    },
  });
  const hooked: unknown[] = [];
  const job = lateCancel(value, { disposeResult: (result) => hooked.push(result) });
  await assert.rejects(job.promise, (error) => error === 'late abort');
  assert.equal(disposed, true);
  assert.deepEqual(hooked, [value]);
  assert.equal(job.getSnapshot().status, 'cancelled');
});

test('a disposer that cannot be read keeps the cancellation and still reaches the host hook', async () => {
  const value = {
    get dispose(): () => void {
      throw new Error('resource access failed');
    },
  };
  const hooked: unknown[] = [];
  const job = lateCancel(value, { disposeResult: (result) => hooked.push(result) });
  await assert.rejects(job.promise, (error) => error === 'late abort');
  assert.deepEqual(hooked, [value]);
  assert.equal(job.getSnapshot().status, 'cancelled');
});

test('cleanup reads a lazy disposer once and calls it on its result', async () => {
  let accesses = 0;
  let receiver: unknown;
  const value = {
    get dispose() {
      accesses++;
      if (accesses > 1) throw new Error('disposer already acquired');
      return function (this: unknown) {
        receiver = this;
      };
    },
  };
  const job = lateCancel(value);
  await assert.rejects(job.promise, (error) => error === 'late abort');
  assert.equal(receiver, value);
  assert.equal(accesses, 1);
});

test('a dispose field that is not a function is never called', async () => {
  let invoked = false;
  const job = lateCancel({
    dispose: {
      call() {
        invoked = true;
      },
    },
  });
  await assert.rejects(job.promise, (error) => error === 'late abort');
  assert.equal(invoked, false);
  assert.equal(job.getSnapshot().status, 'cancelled');
});

test('cancellation before a result exists does not dispose an undefined result', async () => {
  const disposed: unknown[] = [];
  const job = lateCancel(undefined, { disposeResult: (value) => disposed.push(value) });
  await assert.rejects(job.promise, (error) => error === 'late abort');
  assert.deepEqual(disposed, []);
});

test('the external abort listener is released after completion, failure and cancellation', async () => {
  for (const end of ['complete', 'fail', 'cancel'] as const) {
    const controller = new AbortController();
    let finish!: () => void;
    const job = createJob(
      end,
      async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (end === 'fail') throw new Error('failure');
        return 5;
      },
      { signal: controller.signal },
    );
    await Promise.resolve();
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
    if (end === 'cancel') controller.abort();
    finish();
    if (end === 'complete') assert.equal(await job.promise, 5);
    else await assert.rejects(job.promise);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    const terminal = job.getSnapshot();
    controller.abort();
    assert.equal(job.getSnapshot(), terminal);
  }
});

test('the job keeps the signal it was given when the caller edits its options while it runs', async () => {
  const controller = new AbortController();
  const options: { signal?: AbortSignal } = { signal: controller.signal };
  let finish!: (value: number) => void;
  const job = createJob(
    'edited-options',
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    options,
  );
  await Promise.resolve();
  delete options.signal;
  controller.abort('stop');
  finish(42);
  await assert.rejects(job.promise, (error) => error === 'stop');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
