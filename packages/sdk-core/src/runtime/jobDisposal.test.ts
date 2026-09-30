import test from 'node:test';
import assert from 'node:assert/strict';
import { disposeOwned } from './jobDisposal.ts';

/** Disposes `value` and returns what reached the host hook. */
const hooked = <T>(value: T) => {
  const seen: unknown[] = [];
  disposeOwned(value, (result) => seen.push(result));
  return seen;
};

test('a result with a disposer is disposed on itself, then handed to the host hook', () => {
  const order: unknown[] = [];
  const value = {
    dispose(this: unknown) {
      order.push(this);
    },
  };
  disposeOwned(value, () => order.push('hook'));
  assert.deepEqual(order, [value, 'hook']);
});

test('a callable result with a disposer is disposed like any other owned result', () => {
  let disposed = false;
  const value = Object.assign(() => 42, {
    dispose: () => {
      disposed = true;
    },
  });
  assert.deepEqual(hooked(value), [value]);
  assert.equal(disposed, true);
});

test('a value with no function to dispose it only reaches the host hook', () => {
  let invoked = false;
  const notCallable = { call: () => (invoked = true) };
  for (const value of [null, 0, 'value', {}, { dispose: 7 }, { dispose: notCallable }])
    assert.deepEqual(hooked(value), [value]);
  assert.equal(invoked, false);
});

test('a lazy disposer is read once', () => {
  let accesses = 0,
    disposed = false;
  const value = {
    get dispose() {
      accesses++;
      if (accesses > 1) throw new Error('disposer already acquired');
      return () => (disposed = true);
    },
  };
  hooked(value);
  assert.equal(disposed, true);
  assert.equal(accesses, 1);
});

test('a failing disposer, an unreadable one or a failing hook never throws out, and the hook still runs', () => {
  const failing = {
    dispose() {
      throw new Error('dispose failed');
    },
  };
  const unreadable = {
    get dispose(): () => void {
      throw new Error('resource access failed');
    },
  };
  for (const value of [failing, unreadable]) assert.deepEqual(hooked(value), [value]);
  assert.doesNotThrow(() =>
    disposeOwned(failing, () => {
      throw new Error('host hook failed');
    }),
  );
});
