// Lot H2: the real entry point of the decode worker, run by a real `worker_threads` thread
// (the bridge of `bench/oracles/pageDecodeNodeWorker.ts`), without touching the file itself.
// Hostile inputs: a message of another contract version, a cancellation before any work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { NodeDomWorker } from './bench/oracles/pageDecodeNodeWorker.ts';
import type { PageDecodeAnswer } from '../sdk-core/index.ts';

const SOURCE = new URL('./pageDecodeWorker.ts', import.meta.url);

/** The next message received from the worker, or a timeout elapsed with nothing received. The timeout is wide: on a loaded machine, worker startup exceeds a second, and assertions rest on the identifier received, never on time. */
function next(worker: NodeDomWorker, timeoutMs = 10_000): Promise<PageDecodeAnswer | null> {
  return new Promise((resolve) => {
    const minuteur = setTimeout(() => resolve(null), timeoutMs);
    worker.onmessage = (event: { data: unknown }) => {
      clearTimeout(minuteur);
      resolve(event.data as PageDecodeAnswer);
    };
  });
}

test('a message of another protocol is ignored, the next valid request answers alone', async () => {
  const worker = new NodeDomWorker(SOURCE);
  try {
    worker.postMessage({ protocol: 999, id: 1, op: 'verify', source: new ArrayBuffer(8) }, []);
    worker.postMessage(
      {
        protocol: PAGE_DECODE_PROTOCOL,
        id: 2,
        op: 'verify',
        source: new ArrayBuffer(8),
        maxDecodedBytes: 0,
      },
      [],
    );
    const reponse = await next(worker);
    assert.ok(reponse, 'no answer received');
    assert.equal(reponse!.id, 2, 'the off-protocol message answered wrongly');
    assert.equal(reponse!.ok, true);
  } finally {
    await worker.terminate();
  }
});

test('a cancellation received before work answers PAGE_DECODE_CANCELLED, never the decode', async () => {
  const worker = new NodeDomWorker(SOURCE);
  try {
    worker.postMessage({ protocol: PAGE_DECODE_PROTOCOL, id: 7, op: 'cancel' }, []);
    worker.postMessage(
      {
        protocol: PAGE_DECODE_PROTOCOL,
        id: 7,
        op: 'verify',
        source: new ArrayBuffer(8),
        maxDecodedBytes: 0,
      },
      [],
    );
    const reponse = await next(worker);
    assert.ok(reponse);
    assert.equal(reponse!.ok, false);
    assert.equal((reponse as { code: string }).code, 'PAGE_DECODE_CANCELLED');
  } finally {
    await worker.terminate();
  }
});

test('a valid request after cancellation of another identifier proceeds normally', async () => {
  const worker = new NodeDomWorker(SOURCE);
  try {
    worker.postMessage({ protocol: PAGE_DECODE_PROTOCOL, id: 1, op: 'cancel' }, []);
    worker.postMessage(
      {
        protocol: PAGE_DECODE_PROTOCOL,
        id: 2,
        op: 'verify',
        source: new ArrayBuffer(8),
        maxDecodedBytes: 0,
      },
      [],
    );
    const reponse = await next(worker);
    assert.ok(reponse);
    assert.equal(reponse!.id, 2);
    assert.equal(reponse!.ok, true);
  } finally {
    await worker.terminate();
  }
});
