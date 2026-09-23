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
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import {
  DeadNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from '../../../../../bench/oracles/browser/pageDecodeNodeWorker.ts';

async function page() {
  const { data } = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  });
  return data as Uint8Array;
}

function avecCoeurs<T>(n: number, run: () => Promise<T>) {
  const precedent = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: n },
    configurable: true,
  });
  return run().finally(() => {
    if (precedent) Object.defineProperty(globalThis, 'navigator', precedent);
  });
}

/** Decodes again until the pool really serves one decode off the main thread, or gives up at the
 *  deadline. The only reliable way to know that the startup trial — asynchronous, never awaited —
 *  has settled. The deadline is wide: a Node worker takes a few hundred milliseconds to start on a
 *  loaded CI runner, and the loop stops at the first served decode. */
async function jusquAuPool(delaiMs = 10_000) {
  const limite = Date.now() + delaiMs;
  do {
    await decodePageOffThread(await page());
    if (pageDecodeStats().offThread! > 0) return true;
    await new Promise((r) => setTimeout(r, 10));
  } while (Date.now() < limite);
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
  const donnees = await page();
  const accueil = new Uint8Array(donnees.byteLength + 16);
  accueil.set(donnees, 8); // a partial view, like a page-cache entry.
  const vue = accueil.subarray(8, 8 + donnees.byteLength);
  const decodee = await decodePageOffThread(vue);
  assert.equal(decodee.vertexCount, 3);
  assert.equal(accueil.buffer.byteLength, donnees.byteLength + 16, 'the cache buffer moved');
  for (let i = 0; i < donnees.byteLength; i++)
    assert.equal(vue[i], donnees[i], `byte ${i} altered`);
});

test('pool size is bounded by cores, the cap and admission, and is readable in the metrics', () =>
  withNodeWorkerShim(NodeDomWorker, () =>
    avecCoeurs(8, async () => {
      releasePageDecoders();
      configurePageDecoders(2);
      assert.ok(await jusquAuPool(), 'the pool should eventually serve a decode');
      assert.equal(pageDecodeStats().workers, pageDecodeWorkerCount(8, 2));
      releasePageDecoders();
    }),
  ));

test('a worker dead at startup never prevents decode from finishing, nor does it block', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    const decodee = await decodePageOffThread(await page());
    assert.equal(decodee.vertexCount, 3);
    assert.equal(await jusquAuPool(500), false, 'a dead pool must never end up serving');
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
    assert.ok(await jusquAuPool(), 'once started, the pool must eventually serve a call');
    releasePageDecoders();
  }));

test('a freshly verified page is transferred: its original buffer empties after the call', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    assert.ok(await jusquAuPool(), 'the pool must be ready before the verification that counts');
    const donnees = await page();
    const source = donnees.slice().buffer as ArrayBuffer;
    const { sha256, source: rendu } = await verifyPageBytes(source);
    assert.equal(
      source.byteLength,
      0,
      'the handed-over buffer must be detached after the transfer',
    );
    assert.equal(rendu.byteLength, donnees.byteLength);
    assert.equal(sha256.length, 64);
    releasePageDecoders();
  }));
