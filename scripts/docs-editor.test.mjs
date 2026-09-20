import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { resolveSdkImports } from '../docs/js/code/resolveSdkImports.js';
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

test('SDK resolution preserves ordinary strings, comments and similarly named methods', async () => {
  const code = `// import x from './js/engine.js'
    /* export {x} from './js/engine.js' */
    const ordinary = "'./js/engine.js'";
    const object = { import: value => value };
    export default [ordinary, object.import('./js/engine.js')];`;
  assert.equal(resolveSdkImports(code, sdk), code);
  const result = await execute(code).promise;
  assert.deepEqual(JSON.parse(result.text), ["'./js/engine.js'", './js/engine.js']);
});

test('SDK resolution handles dynamic imports and re-exported bindings', async () => {
  const dynamic = await execute(`const {dotVector3} = await import('./js/engine.js');
    export default dotVector3([2,3,4],[5,6,7]);`).promise;
  assert.deepEqual(dynamic, { ok: true, text: '56' });
  const reexport = await execute(`export {IDENTITY_MATRIX4 as default} from './js/engine.js';`)
    .promise;
  assert.equal(reexport.ok, true);
  assert.equal(JSON.parse(reexport.text).length, 16);
});
