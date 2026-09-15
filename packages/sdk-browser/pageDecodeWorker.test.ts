// Lot H2 : le point d'entrée réel du worker de décodage, exécuté par un vrai fil `worker_threads`
// (le pont de `bench/oracles/pageDecodeNodeWorker.mjs`), sans toucher au fichier lui-même. Entrées
// hostiles : un message d'une autre version du contrat, une annulation avant tout travail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { NodeDomWorker } from './bench/oracles/pageDecodeNodeWorker.mjs';
import type { PageDecodeAnswer } from '../sdk-core/index.ts';

const SOURCE = new URL('./pageDecodeWorker.ts', import.meta.url);

/** Le prochain message reçu du worker, ou un délai écoulé sans rien recevoir. */
function next(worker: NodeDomWorker, timeoutMs = 300): Promise<PageDecodeAnswer | null> {
  return new Promise((resolve) => {
    const minuteur = setTimeout(() => resolve(null), timeoutMs);
    worker.onmessage = (event: { data: unknown }) => {
      clearTimeout(minuteur);
      resolve(event.data as PageDecodeAnswer);
    };
  });
}

test('un message d’un autre protocole est ignoré, la requête valide suivante répond seule', async () => {
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
    assert.ok(reponse, 'aucune réponse reçue');
    assert.equal(reponse!.id, 2, 'le message hors protocole a répondu à tort');
    assert.equal(reponse!.ok, true);
  } finally {
    await worker.terminate();
  }
});

test('une annulation reçue avant le travail répond PAGE_DECODE_CANCELLED, jamais le décodage', async () => {
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

test('une requête valide après l’annulation d’un autre identifiant se déroule normalement', async () => {
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
