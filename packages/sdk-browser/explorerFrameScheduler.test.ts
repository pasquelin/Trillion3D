import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerFrameScheduler } from './explorerFrameScheduler.ts';

function fixture(pending = async () => false) {
  const frames = new Map<number, FrameRequestCallback>();
  const errors: unknown[] = [];
  let next = 0,
    renders = 0,
    limited = 0;
  const scheduler = createExplorerFrameScheduler({
    request(callback) {
      frames.set(++next, callback);
      return next;
    },
    cancel: (id) => {
      frames.delete(id);
    },
    render: () => {
      renders++;
    },
    pending,
    error: (error) => {
      errors.push(error);
    },
    limited: () => {
      limited++;
    },
  });
  return {
    ...scheduler,
    frames,
    errors,
    get renders() {
      return renders;
    },
    get limited() {
      return limited;
    },
    async frame() {
      const entry = frames.entries().next().value;
      assert.ok(entry);
      frames.delete(entry[0]);
      entry[1](0);
      await Promise.resolve();
    },
  };
}

test('input coalesces, pending work advances, and a settled scene schedules nothing', async () => {
  let remaining = 3;
  const run = fixture(async () => --remaining > 0);
  run.invalidate();
  run.invalidate();
  assert.equal(run.frames.size, 1);
  for (let i = 0; i < 3; i++) await run.frame();
  assert.equal(run.renders, 3);
  assert.equal(run.frames.size, 0);
});

test('a slow asynchronous wait does not prevent camera input from rendering', async () => {
  let finish!: (value: boolean) => void;
  const run = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  run.invalidate();
  await run.frame();
  assert.equal(run.frames.size, 0);
  run.invalidate();
  await run.frame();
  assert.equal(run.renders, 2);
  run.dispose();
  finish(true);
  await Promise.resolve();
  assert.equal(run.frames.size, 0);
});

test('disposal cancels a queued frame and rendering errors stop the scheduler', async () => {
  const run = fixture(async () => {
    throw Error('device lost');
  });
  run.invalidate();
  await run.frame();
  assert.match(String(run.errors[0]), /device lost/);
  run.invalidate();
  assert.equal(run.frames.size, 0);
  const queued = fixture();
  queued.invalidate();
  queued.dispose();
  assert.equal(queued.frames.size, 0);
});

test('unsettled work has a published finite bound and a new input resumes it', async () => {
  const run = fixture(async () => true);
  run.invalidate();
  for (let i = 0; i < 120; i++) await run.frame();
  assert.equal(run.frames.size, 0);
  assert.equal(run.limited, 1);
  run.invalidate();
  await run.frame();
  assert.equal(run.renders, 121);
  run.dispose();
});

test('a stale idle answer cannot strand work submitted by a newer camera input', async () => {
  let finish!: (value: boolean) => void;
  const run = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  run.invalidate();
  await run.frame();
  run.invalidate();
  await run.frame();
  finish(false);
  await Promise.resolve();
  assert.equal(run.frames.size, 1, 'the newer frame still needs its feedback drained');
  run.dispose();
});
