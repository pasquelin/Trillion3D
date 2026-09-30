import assert from 'node:assert/strict';
import test from 'node:test';
import { createJob } from './jobs.ts';

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
  const listener = () => {
    const snapshot = job.getSnapshot();
    assert.ok(Object.isFrozen(snapshot));
    observed.push(snapshot);
  };
  const unsubscribe = job.subscribe(listener);
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
    error: { code: 'JOB_FAILED', message: 'Error: cannot parse this asset' },
  });
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
    const controller = new AbortController();
    const hooked: unknown[] = [];
    const job = createJob(
      'late',
      async () => {
        controller.abort('late abort');
        return value;
      },
      {
        signal: controller.signal,
        disposeResult(result) {
          hooked.push(result);
          throw new Error('host hook failed');
        },
      },
    );
    await assert.rejects(job.promise, (error) => error === 'late abort');
    assert.deepEqual(hooked, [value]);
    assert.equal(job.getSnapshot().status, 'cancelled');
    assert.equal(job.getSnapshot().result, null);
  }
});

test('external abort listeners are removed after completion and failure', async () => {
  for (const reject of [false, true]) {
    const controller = new AbortController();
    const calls: unknown[][] = [];
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.removeEventListener = (
      ...args: Parameters<AbortSignal['removeEventListener']>
    ) => {
      calls.push(args);
      remove(...args);
    };
    const job = createJob(
      'external',
      async () => {
        if (reject) throw new Error('failure');
        return 5;
      },
      { signal: controller.signal },
    );
    if (reject) await assert.rejects(job.promise, /failure/);
    else assert.equal(await job.promise, 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'abort');
    const terminal = job.getSnapshot();
    controller.abort();
    assert.equal(job.getSnapshot(), terminal);
  }
});

test('cancellation before a result exists does not dispose an undefined result', async () => {
  const controller = new AbortController();
  const disposed: unknown[] = [];
  const job = createJob(
    'no-result',
    async () => {
      controller.abort('cancelled without a value');
      return undefined;
    },
    {
      signal: controller.signal,
      disposeResult(value) {
        disposed.push(value);
      },
    },
  );
  await assert.rejects(job.promise, (error) => error === 'cancelled without a value');
  assert.deepEqual(disposed, []);
});
