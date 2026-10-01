import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldXr } from './session.ts';
import { XrSessionEmulator } from './session.fixture.ts';

for (const ending of ['exit', 'browser end', 'rejected end'] as const) {
  test(`world disposal after ${ending} waits for outstanding eye resources`, async () => {
    const session = new XrSessionEmulator(),
      errors: unknown[] = [];
    const failure = new Error('native end failed');
    let finish!: () => void,
      released = 0,
      complete = false;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const xr = createWorldXr({
      system: () => ({ isSessionSupported: async () => true, requestSession: async () => session }),
      active() {},
      failed: (error) => errors.push(error),
      open: async () => ({
        draw() {},
        dispose() {
          released++;
          return held;
        },
      }),
    });
    await xr.enterVR();
    if (ending === 'rejected end')
      session.end = async () => {
        throw failure;
      };
    const ended = ending === 'browser end' ? session.end() : xr.exit();
    const disposing = Promise.resolve(xr.dispose()).then(() => {
      complete = true;
    });
    await new Promise(setImmediate);
    assert.equal(complete, false, 'world resources must outlive the outstanding eye release');
    assert.equal(session.callbacks.size, 0);
    assert.equal(released, 1);
    finish();
    await Promise.all([ended, disposing]);
    assert.equal(complete, true);
    assert.deepEqual(errors, ending === 'rejected end' ? [failure] : []);
    await xr.dispose();
    assert.equal(released, 1);
  });
}

test('world disposal waits for a renderer that finishes opening after browser end', async () => {
  const session = new XrSessionEmulator();
  let open!: () => void,
    free!: () => void,
    complete = false;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  const held = new Promise<void>((resolve) => {
    free = resolve;
  });
  const xr = createWorldXr({
    system: () => ({ isSessionSupported: async () => true, requestSession: async () => session }),
    active() {},
    failed: (error) => assert.fail(String(error)),
    open: async () => {
      await ready;
      return { draw() {}, dispose: () => held };
    },
  });
  const entering = xr.enterVR();
  await new Promise(setImmediate);
  await session.end();
  open();
  await new Promise(setImmediate);
  const disposing = Promise.resolve(xr.dispose()).then(() => {
    complete = true;
  });
  await new Promise(setImmediate);
  assert.equal(complete, false);
  free();
  await Promise.all([entering, disposing]);
  assert.equal(complete, true);
});
