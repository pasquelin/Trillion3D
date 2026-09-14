import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob } from './index.ts';
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
test('Cancel after work returns disposes a result that never reached completed', async () => {
  let disposed = false;
  const controller = new AbortController();
  const job = createJob(
    'late-cancel',
    async () => {
      controller.abort();
      return {
        dispose() {
          disposed = true;
        },
      };
    },
    { signal: controller.signal },
  );
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
