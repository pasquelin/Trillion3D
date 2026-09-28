import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePace } from './frameBudget.ts';
import { stubPage } from '../../world/render/frameQueue.fixture.ts';

// A page hidden while the pace waits for a frame gets none: the wait ends there, never stalls (#983).
test('a page hidden while a share waits for its frame opens it without one', async () => {
  const page = stubPage('visible');
  try {
    let opened = 0;
    const next = createSharePace(() => opened++, 1);
    await next();
    assert.equal(opened, 1, 'the first share after a task');
    let done = false;
    const waiting = next().then(() => (done = true));
    await new Promise(setImmediate);
    assert.equal(done, false, 'the second waits for a frame that does not come');
    page.document.visibilityState = 'hidden';
    for (const listener of [...page.listeners]) listener();
    await waiting;
    assert.equal(opened, 2);
    assert.equal(page.listeners.size, 0, 'the wait left no listener');
    assert.equal(page.frames.size, 0, 'nor a frame asked');
  } finally {
    page.restore();
  }
});
