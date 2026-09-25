import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerCaptureView } from './view.ts';

test('a view captured aside asks the loop for the view it put back (#349)', async () => {
  const calls: string[] = [];
  let taken: Promise<Uint8Array> = Promise.resolve(new Uint8Array(8));
  const active = { captureColorView: () => (calls.push('capture'), taken) };
  const captureView = createExplorerCaptureView({
    camera: {} as never,
    active: () => active as never,
    check() {},
    compose: (() => {}) as never,
    redraw: () => void calls.push('redraw'),
  });
  await captureView(2, 1);
  assert.deepEqual(calls, ['capture', 'redraw']);
  taken = Promise.reject(new Error('CAPTURE_NOT_READY'));
  await assert.rejects(captureView(2, 1), /CAPTURE_NOT_READY/);
  assert.equal(calls.at(-1), 'redraw', 'a failed capture put the view back too');
});
