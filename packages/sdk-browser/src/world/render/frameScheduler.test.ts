import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerFrameScheduler } from './frameScheduler.ts';
import { frameQueue } from './frameQueue.fixture.ts';

function fixture(pending = async () => false) {
  const frames = frameQueue();
  const errors: unknown[] = [];
  let renders = 0,
    limited = 0;
  const scheduler = createExplorerFrameScheduler({
    request: frames.request,
    cancel: frames.cancel,
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
      assert.ok(frames.run());
      await new Promise(setImmediate);
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
  // The frame asked right after it comes before the feedback: held, nothing drawn.
  await run.frame();
  assert.equal(run.renders, 1);
  assert.equal(run.frames.size, 0);
  run.invalidate();
  await run.frame();
  assert.equal(run.renders, 2);
  run.dispose();
  finish(true);
  await new Promise(setImmediate);
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
  // The newer frame asked the next one at once; it comes before the feedback and is held.
  await run.frame();
  assert.equal(run.renders, 2);
  finish(false);
  await new Promise(setImmediate);
  assert.equal(run.frames.size, 1, 'the newer frame still needs its feedback drained');
  run.dispose();
});

/** A loop whose every feedback waits for the test, and says the loop goes on. */
function manual() {
  const answers: ((again: boolean) => void)[] = [];
  const log: string[] = [];
  const run = fixture(
    () =>
      new Promise<boolean>((resolve) => {
        const n = run.renders;
        answers.push((again) => {
          log.push(`feedback ${n}`);
          resolve(again);
        });
      }),
  );
  return { run, answers, log };
}

test('the next frame is asked right after render, and a stop cancels it (#983)', async () => {
  const { run, answers } = manual();
  run.invalidate();
  await run.frame();
  assert.equal(run.frames.size, 1, 'asked before the feedback lands');
  answers.shift()!(false);
  await new Promise(setImmediate);
  assert.equal(run.frames.size, 0, 'a settled scene cancels it');
  assert.equal(run.renders, 1);
});

test('frames before their feedback are held: no settle round, no revision, same order (#983)', async () => {
  const { run, answers, log } = manual();
  const queued = run.frames;
  run.invalidate();
  for (let i = 0; i < 2 * 120 && queued.size; i++) {
    const drawn = run.renders;
    await run.frame();
    if (run.renders > drawn) log.push(`render ${run.renders}`);
    // The frame asked right after the render comes before its feedback: held.
    if (queued.size) await run.frame();
    assert.equal(run.renders, drawn + 1, 'a held frame draws nothing');
    answers.shift()!(true);
    await new Promise(setImmediate);
  }
  assert.equal(run.renders, 120, 'held frames spent none of the settle limit');
  assert.equal(run.limited, 1);
  // Frame n's feedback always lands before frame n+1 draws.
  for (let n = 1; n < 120; n++)
    assert.ok(log.indexOf(`feedback ${n}`) < log.indexOf(`render ${n + 1}`), `frame ${n}`);
});

test('a held frame moves no revision: a stop answered after one pauses the loop (#983)', async () => {
  const stop = manual();
  stop.run.invalidate();
  await stop.run.frame();
  await stop.run.frame();
  stop.answers.shift()!(false);
  await new Promise(setImmediate);
  assert.equal(stop.run.frames.size, 0);
  assert.equal(stop.run.renders, 1);
});
