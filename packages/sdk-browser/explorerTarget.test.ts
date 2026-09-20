import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createExplorer, createExplorerJob } from './index.ts';
import { resolveExplorerTarget } from './explorerTarget.ts';
import { interactiveOptions, interactiveSize } from './explorerInteractiveOptions.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';

const canvas = () =>
  ({
    nodeName: 'CANVAS',
    getContext() {},
    clientWidth: 640,
    clientHeight: 360,
    ownerDocument: { defaultView: { devicePixelRatio: 2 } },
  }) as unknown as HTMLCanvasElement;
function documentFor(t: TestContext, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
}
const options = { manifestUrl: 'http://localhost/cache/manifest.json' };

test('element targets need no global document; literal IDs resolve the same element', (t) => {
  const element = canvas();
  assert.equal(resolveExplorerTarget(element), element);
  documentFor(t, {
    getElementById: (id: string) => (id === 'a:b' ? element : null),
  } as Document);
  assert.equal(resolveExplorerTarget('a:b'), element);
  assert.throws(() => resolveExplorerTarget('#a:b'), /No canvas/);
});

test('invalid targets fail before any network request, including job targets', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw Error('must not fetch');
  });
  await assert.rejects(createExplorer('', options), /must not be empty/);
  await assert.rejects(createExplorer('missing', options), /requires a document/);
  documentFor(t, {
    getElementById: (id: string) => (id === 'div' ? { nodeName: 'DIV' } : null),
  } as Document);
  await assert.rejects(createExplorer('missing', options), /No canvas/);
  await assert.rejects(createExplorer('div', options), /must be a canvas/);
  await assert.rejects(
    createExplorer(null as unknown as HTMLCanvasElement, options),
    /must be a canvas/,
  );
  const job = await createExplorerJob('job-id', 'missing', options);
  await assert.rejects(job.promise, /No canvas/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('interactive options derive CSS size and DPR with explicit overrides; manual defaults stay intact', () => {
  const element = canvas();
  assert.equal(interactiveOptions(element, options), options);
  const automatic = interactiveOptions(element, { ...options, interactive: true, scope: 'full' });
  assert.deepEqual([automatic.width, automatic.height, automatic.pixelRatio], [640, 360, 2]);
  assert.deepEqual(automatic.backends, [webgpuPagesBackend]);
  assert.equal(automatic.scope, 'full');
  assert.equal(automatic.geometryPoolBytes, undefined);
  assert.deepEqual(interactiveSize(element, { ...options, width: 10, pixelRatio: 1 }), {
    width: 10,
    height: 360,
    pixelRatio: 1,
  });
  const explicit = {
    ...options,
    interactive: true,
    backends: [],
    geometryPoolBytes: 16 * 1024 * 1024,
  };
  assert.equal(interactiveOptions(element, explicit).backends, explicit.backends);
  assert.equal(interactiveOptions(element, explicit).geometryPoolBytes, explicit.geometryPoolBytes);
});

test('hidden or invalid initial viewports fail with an actionable error', () => {
  const element = canvas();
  Object.defineProperty(element, 'clientWidth', { value: 0 });
  assert.throws(() => interactiveSize(element, options), /positive CSS size/);
  assert.equal(interactiveSize(element, { ...options, width: 40 }).width, 40);
  for (const pixelRatio of [0, -1, NaN, Infinity])
    assert.throws(
      () => interactiveSize(element, { ...options, width: 40, pixelRatio }),
      /Pixel ratio/,
    );
});
