import test from 'node:test';
import assert from 'node:assert/strict';
import { createArrivalQueue, type ArrivalTarget } from './arrivalQueue.ts';
import { referenceArrivalQueue } from './bench/oracles/streaming.mjs';

function target() {
  const accepted: string[] = [];
  let syncs = 0;
  return {
    accepted,
    get syncs() {
      return syncs;
    },
    acceptPage(url: string) {
      accepted.push(url);
    },
    syncResident() {
      syncs++;
    },
  };
}

test('a drain stops at the byte budget and the next one resumes where it left off', () => {
  const a = target();
  // Trois pages de 8 octets pour un budget de 12 : la deuxième franchit le budget et referme le drain.
  const queue = createArrivalQueue(12, 64);
  for (const url of ['p0', 'p1', 'p2']) assert.equal(queue.queue(a, url, new Uint32Array(2)), true);
  assert.equal(queue.pending, 3);
  assert.equal(queue.drain(), 2, "le budget d'octets arrête le drain");
  assert.deepEqual(a.accepted, ['p0', 'p1'], "ordre d'arrivée conservé");
  assert.equal(a.syncs, 0, 'le rendu suivant synchronise sans soumission intermédiaire');
  assert.equal(queue.pending, 1);
  assert.equal(queue.drain(), 1);
  assert.deepEqual(a.accepted, ['p0', 'p1', 'p2']);
  assert.equal(a.syncs, 0);
  assert.equal(queue.drain(), 0, 'file vide : rien à livrer et aucune résidence');
  assert.equal(a.syncs, 0);
});

test('a page already waiting for a target is queued once, and each target keeps its own residency', () => {
  const a = target(),
    b = target();
  const queue = createArrivalQueue(1 << 20, 2);
  const page = new Uint32Array(1);
  assert.equal(queue.queue(a, 'p0', page), true);
  assert.equal(queue.queue(a, 'p0', page), false, 'déjà en attente pour ce destinataire');
  assert.equal(queue.queue(b, 'p0', page), true, 'chaque destinataire a sa propre résidence');
  assert.equal(queue.queue(a, 'p1', page), true);
  assert.equal(
    queue.queue({} as ArrivalTarget, 'p0', page),
    false,
    'sans acceptPage, rien à livrer',
  );
  assert.equal(queue.drain(), 2, 'le budget de pages arrête le drain');
  assert.deepEqual(a.accepted, ['p0']);
  assert.deepEqual(b.accepted, ['p0']);
  assert.equal(a.syncs, 0);
  assert.equal(b.syncs, 0);
  // La file ne retient que l'attente : une page relivrée plus tard se ré-empile derrière le reste.
  assert.equal(queue.queue(a, 'p0', page), true);
  assert.equal(queue.drain(), 2);
  assert.deepEqual(a.accepted, ['p0', 'p1', 'p0']);
  assert.equal(a.syncs, 0);
  assert.equal(b.syncs, 0);
});

// La livraison garde exactement les pages et leur ordre malgré la suppression du rendu implicite.
test('many duplicate targets across a drain deliver exactly like the reference', () => {
  function arrivals(create: typeof createArrivalQueue) {
    const delivered: string[] = [];
    const targets = Array.from({ length: 8 }, (_, c) => ({
      acceptPage: (url: string) => delivered.push(`${c}:${url}`),
    }));
    const queue = create(1 << 20, 4096);
    const bytes = new Uint32Array(4);
    // Round-robin over the eight targets so the touched list sees many repeats before a drain.
    for (let i = 0; i < 500; i++) queue.queue(targets[i % 8], `page-${i % 50}.bin`, bytes);
    let livrs = 0;
    for (let d = 0; d < 3; d++) livrs += queue.drain();
    return { delivered, livrs };
  }
  const optimisee = arrivals(createArrivalQueue);
  const reference = arrivals(referenceArrivalQueue as typeof createArrivalQueue);
  assert.deepEqual(optimisee, reference);
});
