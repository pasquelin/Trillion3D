import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePace } from './frameBudget.ts';

// A page hidden while the pace waits for a frame gets none: the wait ends there, never stalls (#983).
test('a page hidden while a share waits for its frame opens it without one', async () => {
  const host = globalThis as Record<string, unknown>;
  const listeners: (() => void)[] = [];
  const document = {
    visibilityState: 'visible',
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.splice(listeners.indexOf(listener), 1),
  };
  const stubs = { document, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  Object.assign(host, stubs);
  try {
    let opened = 0;
    const next = createSharePace(() => opened++, 1);
    await next();
    assert.equal(opened, 1, 'the first share after a task');
    let done = false;
    const waiting = next().then(() => (done = true));
    await new Promise(setImmediate);
    assert.equal(done, false, 'the second waits for a frame that does not come');
    document.visibilityState = 'hidden';
    for (const listener of [...listeners]) listener();
    await waiting;
    assert.equal(opened, 2);
    assert.equal(listeners.length, 0, 'the wait left no listener');
  } finally {
    Object.keys(stubs).forEach((key) => delete host[key]);
  }
});
