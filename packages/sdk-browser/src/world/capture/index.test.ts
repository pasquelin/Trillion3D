import test from 'node:test';
import assert from 'node:assert/strict';
import { capture } from './index.ts';
import { registerWorld } from '../core/worldSession.ts';

test('a capture asks the view drawn again, which it put back without the chain (#349)', async () => {
  const calls: string[] = [];
  const session = {
    captureView: async () => (calls.push('capture'), new Uint8Array(2 * 1 * 4)),
    invalidate: () => void calls.push('invalidate'),
  };
  const world = { render: () => void calls.push('render') };
  registerWorld(world, { session: () => session as never, last: () => null });
  await capture.buffer(world, { width: 2, height: 1 });
  assert.deepEqual(calls, ['render', 'capture', 'invalidate']);
  session.captureView = async () => Promise.reject(new Error('CAPTURE_NOT_READY'));
  await assert.rejects(capture.buffer(world, { width: 2, height: 1 }), /CAPTURE_NOT_READY/);
  assert.equal(calls.at(-1), 'invalidate', 'a failed capture put the view back too');
});
