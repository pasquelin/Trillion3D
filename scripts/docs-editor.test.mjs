import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { runModule } from '../docs/js/code/execute.js';
import { formatNumericText } from '../docs/js/code/formatNumber.js';

function createWorker(source) {
  const script = `import { parentPort } from 'node:worker_threads';
    globalThis.postMessage = value => parentPort.postMessage(value);
    ${source}`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`));
  const adapter = { terminate: () => worker.terminate() };
  worker.on('message', (data) => adapter.onmessage?.({ data }));
  worker.on('error', (error) => adapter.onerror?.({ message: error.message }));
  return adapter;
}
const sdk = new URL('../docs/js/engine.js', import.meta.url).href;
const execute = (code, options) => runModule(code, sdk, { createWorker, ...options });

test('edited source executes a real public SDK calculation and returns its value', async () => {
  const response = await execute(`import { dotVector3 } from './js/engine.js';
    export default dotVector3([2,3,4],[5,6,7]);`).promise;
  assert.deepEqual(response, { ok: true, text: '56' });
});

test('syntax and runtime errors are visible execution results', async () => {
  for (const code of ['export default ;', 'throw new Error("Original failure");']) {
    const result = await execute(code).promise;
    assert.equal(result.ok, false);
    assert.ok(result.text.length > 0);
  }
});

test('a nonterminating module times out without blocking the caller', async () => {
  const result = await execute('while(true) {}', { timeout: 100 }).promise;
  assert.deepEqual(result, { ok: false, kind: 'timeout' });
});

test('cancellation terminates a pending module', async () => {
  const task = execute('await new Promise(() => {});');
  task.cancel();
  assert.deepEqual(await task.promise, { ok: false, kind: 'cancelled' });
});

test('numeric presentation is bounded without changing calculation state', () => {
  const state = { angle: 1.23456789012345 };
  assert.equal(formatNumericText(`rotation ${state.angle}°`), 'rotation 1.235°');
  assert.equal(state.angle, 1.23456789012345);
});
