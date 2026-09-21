import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { resolveSdkImports } from '../site/app/code/resolveSdkImports.ts';
import { runModule } from '../site/app/code/execute.ts';
import { formatNumericText } from '../site/app/code/formatNumber.ts';

// The part of a worker `runModule` drives: it assigns `onmessage`/`onerror` itself, this adapter
// only has to relay the underlying `worker_threads` events to whatever it assigned.
interface WorkerAdapter {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  terminate: () => void;
}

function createWorker(source: string): WorkerAdapter {
  const script = `import { parentPort } from 'node:worker_threads';
    globalThis.postMessage = value => parentPort.postMessage(value);
    ${source}`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`));
  const adapter: WorkerAdapter = {
    onmessage: null,
    onerror: null,
    terminate: () => worker.terminate(),
  };
  worker.on('message', (data) => adapter.onmessage?.({ data }));
  worker.on('error', (error) => adapter.onerror?.({ message: error.message }));
  return adapter;
}
const sdk = new URL('../site/demos/engine.ts', import.meta.url).href;
type ExecuteOptions = Omit<NonNullable<Parameters<typeof runModule>[2]>, 'createWorker'>;
const execute = (code: string, options?: ExecuteOptions) =>
  runModule(code, sdk, { createWorker, ...options });

test('edited source executes a real public SDK calculation and returns its value', async () => {
  const response = await execute(`import { dotVector3 } from './js/engine.js';
    export default dotVector3([2,3,4],[5,6,7]);`).promise;
  assert.deepEqual(response, { ok: true, text: '56' });
});

test('syntax and runtime errors are visible execution results', async () => {
  for (const code of ['export default ;', 'throw new Error("Original failure");']) {
    const result = await execute(code).promise;
    assert.equal(result.ok, false);
    assert(result.text);
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
  assert(result.text);
  assert.deepEqual(JSON.parse(result.text), ["'./js/engine.js'", './js/engine.js']);
});

test('SDK resolution handles dynamic imports and re-exported bindings', async () => {
  const dynamic = await execute(`const {dotVector3} = await import('./js/engine.js');
    export default dotVector3([2,3,4],[5,6,7]);`).promise;
  assert.deepEqual(dynamic, { ok: true, text: '56' });
  const reexport = await execute(`export {IDENTITY_MATRIX4 as default} from './js/engine.js';`)
    .promise;
  assert.equal(reexport.ok, true);
  assert(reexport.text);
  assert.equal(JSON.parse(reexport.text).length, 16);
});

test('default string exports remain values rather than module specifiers', async () => {
  for (const expression of ["'./js/engine.js'", "('./js/engine.js')", '`./js/engine.js`']) {
    const code = `export default ${expression};`;
    assert.equal(resolveSdkImports(code, sdk), code);
    assert.deepEqual(await execute(code).promise, { ok: true, text: '"./js/engine.js"' });
  }
});

test('only source positions in supported import and re-export syntax are rewritten', () => {
  for (const prefix of [
    'import',
    'import value from',
    'import * as value from',
    'export * from',
    'export * as value from',
    'export { value } from',
    'import(',
  ]) {
    const suffix = prefix === 'import(' ? ')' : ';';
    const code = `${prefix} /* source */ './js/engine.js'${suffix}`;
    assert.equal(
      resolveSdkImports(code, sdk),
      `${prefix} /* source */ ${JSON.stringify(sdk)}${suffix}`,
    );
  }
});
