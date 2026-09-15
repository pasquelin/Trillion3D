// A12 : la file de transferts est triée une seule fois par passage du `while`, et `findAdmissible`
// remplace le `queue.sort()` + `findIndex` répétés à chaque tour. Oracle : la version qui re-triait
// systématiquement, d'avant le lot A, dans `scripts/mesure/calculs/oracles/streaming.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findAdmissible, sortStreamJobs } from './streamingQueue.ts';
import { referenceAdmission } from '../../scripts/mesure/calculs/oracles/streaming.mjs';

const LIMITE = 6,
  BUDGET = 2 * 1024 * 1024;
function optimiseeAdmission(
  queue: { url: string; priority: number; order: number; consumers: number }[],
  octetsDe: (url: string) => number | undefined,
) {
  const admis: string[] = [];
  let active = 0,
    activeBytes = 0,
    triee = false;
  while (active < LIMITE && queue.length) {
    if (!triee) {
      sortStreamJobs(queue);
      triee = true;
    }
    const at = findAdmissible(queue, active, activeBytes, octetsDe, BUDGET);
    if (at < 0) break;
    const job = queue.splice(at, 1)[0];
    if (job.consumers === 0) continue;
    active++;
    activeBytes += octetsDe(job.url) ?? 0;
    admis.push(job.url);
  }
  return admis;
}

test('an empty queue admits nothing, matching the reference', () => {
  assert.deepEqual(
    optimiseeAdmission([], () => 0),
    [],
  );
  assert.deepEqual(
    referenceAdmission([], () => 0),
    [],
  );
});

test('priority then arrival order decides admission, identically to the reference', () => {
  const jobs = [
    { url: 'c', priority: 2, order: 2, consumers: 1 },
    { url: 'a', priority: 1, order: 0, consumers: 1 },
    { url: 'b', priority: 1, order: 1, consumers: 1 },
  ];
  const octetsDe = () => 1024;
  assert.deepEqual(
    optimiseeAdmission(jobs.slice(), octetsDe),
    referenceAdmission(jobs.slice(), octetsDe),
  );
  assert.deepEqual(optimiseeAdmission(jobs.slice(), octetsDe), ['a', 'b', 'c']);
});

test('a job with zero consumers is skipped by both sides without stopping admission', () => {
  const jobs = [
    { url: 'a', priority: 0, order: 0, consumers: 0 },
    { url: 'b', priority: 1, order: 1, consumers: 1 },
  ];
  const octetsDe = () => 1024;
  assert.deepEqual(optimiseeAdmission(jobs.slice(), octetsDe), ['b']);
  assert.deepEqual(referenceAdmission(jobs.slice(), octetsDe), ['b']);
});

test('the first transfer always admits even alone over budget, then blocks everything behind it', () => {
  const jobs = Array.from({ length: 10 }, (_, i) => ({
    url: `p${i}`,
    priority: 0,
    order: i,
    consumers: 1,
  }));
  const octetsDe = (url: string) => (url === 'p0' ? BUDGET * 4 : 1024);
  const optimisee = optimiseeAdmission(jobs.slice(), octetsDe);
  const reference = referenceAdmission(jobs.slice(), octetsDe);
  assert.deepEqual(optimisee, reference);
  assert.deepEqual(
    optimisee,
    ['p0'],
    'the oversized first transfer admits alone, then no budget remains',
  );
});

test('same-size jobs within budget fill up to the active-transfer limit, identically to the reference', () => {
  const jobs = Array.from({ length: 10 }, (_, i) => ({
    url: `p${i}`,
    priority: 0,
    order: i,
    consumers: 1,
  }));
  const octetsDe = () => 1024;
  const optimisee = optimiseeAdmission(jobs.slice(), octetsDe);
  const reference = referenceAdmission(jobs.slice(), octetsDe);
  assert.deepEqual(optimisee, reference);
  assert.equal(optimisee.length, LIMITE);
});

test('an unknown url (no byte size) is treated as zero cost by both sides', () => {
  const jobs = [{ url: 'missing', priority: 0, order: 0, consumers: 1 }];
  const octetsDe = () => undefined;
  assert.deepEqual(
    optimiseeAdmission(jobs.slice(), octetsDe),
    referenceAdmission(jobs.slice(), octetsDe),
  );
});
