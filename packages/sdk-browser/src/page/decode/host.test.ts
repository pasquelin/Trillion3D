// Lot H2: the decode host — byte accounting, pool cap, startup never awaited, and `null` metrics
// until something is measured. Hostile inputs: a dead worker, a resident page whose shared buffer
// must neither move nor be detached.
//
// The pool's startup probe is never awaited by the code itself (`void pool.start()...`): it settles
// `started` asynchronously, well after the call that triggered it returns. A test that yielded
// before that settlement would let the late resolution overwrite the state of a pool already
// released by the next test; every test that touches the pool therefore waits for the main thread
// to stop serving before releasing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageDecodeWorkerCount } from '../../../../sdk-core/src/index.ts';
import {
  configurePageDecoders,
  decodePageOffThread,
  pageDecodeStats,
  releasePageDecoders,
  verifyPageBytes,
} from './host.ts';
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts';
import {
  DeadNodeWorker,
  FlakyNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from '../../../../../bench/oracles/browser/pageDecodeNodeWorker.ts';

async function page() {
  const { data } = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  });
  return data as Uint8Array;
}

function withCores<T>(n: number, run: () => Promise<T>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: n },
    configurable: true,
  });
  return run().finally(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
  });
}

/** Decodes again until the pool really serves one decode off the main thread, or gives up at the
 *  deadline. The only reliable way to know that the startup trial — asynchronous, never awaited —
 *  has settled. The deadline is wide: a Node worker takes a few hundred milliseconds to start on a
 *  loaded CI runner, and the loop stops at the first served decode. */
async function untilPoolServes(waitMs = 10_000) {
  const endsAt = Date.now() + waitMs;
  do {
    await decodePageOffThread(await page());
    if (pageDecodeStats().offThread! > 0) return true;
    await new Promise((r) => setTimeout(r, 10));
  } while (Date.now() < endsAt);
  return false;
}

test('with no decode, metrics are null, not zero', () => {
  releasePageDecoders();
  assert.deepEqual(pageDecodeStats(), {
    offThread: null,
    wasm: null,
    decodeMs: null,
    workers: null,
  });
});

test('a resident page is never detached: its partial view is copied, not transferred', async () => {
  releasePageDecoders(); // no `Worker` here: force the fallback onto the main thread (`ownBuffer`).
  const pageData = await page();
  const cacheEntry = new Uint8Array(pageData.byteLength + 16);
  cacheEntry.set(pageData, 8); // a partial view, like a page-cache entry.
  const partialView = cacheEntry.subarray(8, 8 + pageData.byteLength);
  const decoded = await decodePageOffThread(partialView);
  assert.equal(decoded.vertexCount, 3);
  assert.equal(cacheEntry.buffer.byteLength, pageData.byteLength + 16, 'the cache buffer moved');
  for (let i = 0; i < pageData.byteLength; i++)
    assert.equal(partialView[i], pageData[i], `byte ${i} altered`);
});

test('pool size is bounded by cores, the cap and admission, and is readable in the metrics', () =>
  withNodeWorkerShim(NodeDomWorker, () =>
    withCores(8, async () => {
      releasePageDecoders();
      configurePageDecoders(2);
      assert.ok(await untilPoolServes(), 'the pool should eventually serve a decode');
      assert.equal(pageDecodeStats().workers, pageDecodeWorkerCount(8, 2));
      releasePageDecoders();
    }),
  ));

test('a worker dead at startup never prevents decode from finishing, nor does it block', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    const decoded = await decodePageOffThread(await page());
    assert.equal(decoded.vertexCount, 3);
    assert.equal(await untilPoolServes(500), false, 'a dead pool must never end up serving');
    assert.equal(pageDecodeStats().workers, 0);
    releasePageDecoders();
  }));

test('the startup probe is never awaited: the first call goes through the main thread', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    await decodePageOffThread(await page());
    assert.equal(
      pageDecodeStats().offThread,
      0,
      'the first call must not have waited for the pool',
    );
    assert.ok(await untilPoolServes(), 'once started, the pool must eventually serve a call');
    releasePageDecoders();
  }));

test('a freshly verified page is transferred: its original buffer empties after the call', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    assert.ok(
      await untilPoolServes(),
      'the pool must be ready before the verification that counts',
    );
    const pageData = await page();
    const source = pageData.slice().buffer as ArrayBuffer;
    const { sha256, source: returned } = await verifyPageBytes(source);
    assert.equal(
      source.byteLength,
      0,
      'the handed-over buffer must be detached after the transfer',
    );
    assert.equal(returned.byteLength, pageData.byteLength);
    assert.equal(sha256.length, 64);
    releasePageDecoders();
  }));

test('a verify whose worker vanished before taking the bytes is done on the main thread', () =>
  withNodeWorkerShim(FlakyNodeWorker as unknown as typeof NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    const pageData = await page();
    // The first call opens the pool and is served on the main thread; the probe answers.
    await verifyPageBytes(pageData.slice().buffer as ArrayBuffer);
    await new Promise((r) => setTimeout(r, 0));
    // The worker dies on this one without taking its buffer: the bytes are whole.
    const { sha256, source } = await verifyPageBytes(pageData.slice().buffer as ArrayBuffer);
    assert.equal(sha256.length, 64);
    assert.equal(source.byteLength, pageData.byteLength);
    releasePageDecoders();
  }));
