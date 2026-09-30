import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { createJob } from './jobs.ts';

test('a callable result remains host-owned when cancellation wins the work race', async () => {
  let disposed = false;
  const value = Object.assign(() => 42, {
    dispose: () => {
      disposed = true;
    },
  });
  const hooked: unknown[] = [];
  const external = new AbortController();
  const job = createJob(
    'callable',
    async () => {
      external.abort('cancelled');
      return value;
    },
    { signal: external.signal, disposeResult: (result) => hooked.push(result) },
  );
  await assert.rejects(job.promise, (error) => error === 'cancelled');
  assert.equal(disposed, false);
  assert.equal(hooked.length, 1);
  assert.equal(hooked[0], value);
  assert.equal(job.getSnapshot().status, 'cancelled');
});

test('an attached abort relay still cancels after the optional signal reference is removed', async () => {
  const external = new AbortController();
  const options: { signal?: AbortSignal } = { signal: external.signal };
  let relay!: EventListenerOrEventListenerObject;
  const add = external.signal.addEventListener.bind(external.signal);
  external.signal.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => {
    relay = args[1];
    add(...args);
  };
  let finish!: (value: number) => void;
  const job = createJob(
    'detached-options',
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    options,
  );
  await Promise.resolve();
  delete options.signal;
  // Invoke the registered relay directly so a regression is a synchronous assertion failure.
  // Node otherwise reports an EventTarget listener exception as an uncaught process error.
  assert.equal(typeof relay, 'function');
  assert.doesNotThrow(() => (relay as EventListener).call(external.signal, new Event('abort')));
  finish(42);
  await assert.rejects(job.promise, { name: 'AbortError' });
  assert.equal(job.getSnapshot().status, 'cancelled');
});

test('a failing disposal getter cannot replace cancellation or bypass host cleanup', async () => {
  const value = {
    get dispose(): () => void {
      throw new Error('resource access failed');
    },
  };
  const external = new AbortController();
  const hooked: unknown[] = [];
  const job = createJob(
    'unreadable-disposal',
    async () => {
      external.abort('stop');
      return value;
    },
    { signal: external.signal, disposeResult: (result) => hooked.push(result) },
  );
  await assert.rejects(job.promise, (error) => error === 'stop');
  assert.equal(hooked.length, 1);
  assert.equal(hooked[0], value);
  assert.equal(job.getSnapshot().status, 'cancelled');
});

test('cleanup resolves a lazy disposer once and preserves its receiver', async () => {
  let accesses = 0;
  let disposed = false;
  const value = {
    get dispose() {
      accesses++;
      if (accesses > 1) throw new Error('disposer already acquired');
      return function (this: unknown) {
        assert.equal(this, value);
        disposed = true;
      };
    },
  };
  const external = new AbortController();
  const job = createJob(
    'lazy-disposal',
    async () => {
      external.abort('stop');
      return value;
    },
    { signal: external.signal },
  );
  await assert.rejects(job.promise, (error) => error === 'stop');
  assert.equal(disposed, true);
  assert.equal(accesses, 1);
});

test('a nonfunction dispose descriptor is never executed as a cleanup method', async () => {
  let invoked = false;
  const value = {
    dispose: {
      call() {
        invoked = true;
      },
    },
  };
  const external = new AbortController();
  const job = createJob(
    'disposal-descriptor',
    async () => {
      external.abort('stop');
      return value;
    },
    { signal: external.signal },
  );
  await assert.rejects(job.promise, (error) => error === 'stop');
  assert.equal(invoked, false);
  assert.equal(job.getSnapshot().status, 'cancelled');
});

test('external abort releases its listener even when the caller removed the signal reference', async () => {
  const external = new AbortController();
  const options: { signal?: AbortSignal } = { signal: external.signal };
  let finish!: (value: number) => void;
  const job = createJob(
    'released-signal',
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    options,
  );
  await Promise.resolve();
  assert.equal(getEventListeners(external.signal, 'abort').length, 1);
  delete options.signal;
  external.abort();
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
  finish(42);
  await assert.rejects(job.promise, { name: 'AbortError' });
});
