// A12 : la file de transferts est triée une seule fois par passage du `while`, et `findAdmissible`
// remplace le `queue.sort()` + `findIndex` répétés à chaque tour. Oracle : la version qui re-triait
// systématiquement, d'avant le lot A, dans `bench/oracles/admission-arrivees.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compacteFile, findAdmissible } from './streamingQueueOrder.ts';
import { sortStreamJobs } from './streamingQueueOrderFixture.ts';
import { referenceAdmission } from './bench/oracles/admission-arrivees.mjs';
import type { Job } from './streamingTypes.ts';

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

// G5 : une demande annulée est marquée `dropped` puis la file est compactée en un seul passage
// (`compacteFile`) au prochain `pump`, au lieu d'être retrouvée par `queue.indexOf` et retirée par
// `splice` à chaque annulation. Oracle du retrait immédiat : `referenceRetireDeLaFile`, recopié tel
// quel d'avant le lot G dans `bench/oracles/recherches-streaming.mjs`.
{
  const { referenceRetireDeLaFile } = await import('./bench/oracles/recherches-streaming.mjs');

  function job(url: string): Job {
    return {
      url,
      priority: 0,
      order: 0,
      controller: new AbortController(),
      state: 'queued',
      consumers: new Set(),
      promise: new Promise(() => {}),
      resolve: () => {},
      reject: () => {},
    };
  }

  function urls(queue: Job[]) {
    return queue.map((j) => j.url);
  }

  test('annulation, réadmission puis drain donnent la même file que le retrait immédiat', () => {
    const ancienne = ['a', 'b', 'c', 'd'].map(job);
    const nouvelle = ['a', 'b', 'c', 'd'].map(job);

    // Annulation de 'b' : l'ancienne le retire tout de suite, la nouvelle le marque seulement.
    referenceRetireDeLaFile(
      ancienne,
      ancienne.find((j) => j.url === 'b')!,
    );
    const cible = nouvelle.find((j) => j.url === 'b')!;
    cible.state = 'dropped';

    // Réadmission : une nouvelle demande arrive pendant que 'b' est encore dans le tableau côté nouvelle.
    ancienne.push(job('e'));
    nouvelle.push(job('e'));

    // Une seconde annulation, sur 'd' cette fois.
    referenceRetireDeLaFile(
      ancienne,
      ancienne.find((j) => j.url === 'd')!,
    );
    nouvelle.find((j) => j.url === 'd')!.state = 'dropped';

    // Drain : la nouvelle compacte enfin, en un passage.
    compacteFile(nouvelle);

    assert.deepEqual(urls(nouvelle), urls(ancienne));
    assert.deepEqual(urls(nouvelle), ['a', 'c', 'e']);
  });

  test('annuler un travail absent de la file, ou déjà marqué, ne perturbe pas le compactage', () => {
    const queue = ['a', 'b'].map(job);
    const étranger = job('x');
    referenceRetireDeLaFile(queue, étranger); // absent : indexOf renvoie -1, rien ne bouge
    compacteFile(queue); // rien de marqué : rien ne bouge non plus
    assert.deepEqual(urls(queue), ['a', 'b']);

    queue[0].state = 'dropped';
    compacteFile(queue);
    compacteFile(queue); // un second compactage sur une file déjà propre est un no-op
    assert.deepEqual(urls(queue), ['b']);
  });

  test('annuler la file entière la vide, comme des retraits un par un', () => {
    const ancienne = ['p0', 'p1', 'p2', 'p3'].map(job);
    const nouvelle = ['p0', 'p1', 'p2', 'p3'].map(job);
    for (const j of [...ancienne]) referenceRetireDeLaFile(ancienne, j);
    for (const j of nouvelle) j.state = 'dropped';
    compacteFile(nouvelle);
    assert.deepEqual(urls(ancienne), []);
    assert.deepEqual(urls(nouvelle), []);
  });
}
