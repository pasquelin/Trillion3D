// A12: the transfer queue is sorted once per `while` pass, and `findAdmissible`
// replaces the `queue.sort()` + `findIndex` repeated each turn. Oracle: the version that
// systematically re-sorted, from before batch A, in `../../../../bench/oracles/browser/admission-arrivees.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compacteFile, findAdmissible } from './queueOrder.ts';
import { sortStreamJobs } from './queueOrder.fixture.ts';
import { referenceAdmission } from '../../../../bench/oracles/browser/admission-arrivees.ts';
import type { Job } from './types.ts';

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

// G5: a cancelled request is marked `dropped` then the queue is compacted in one pass
// (`compacteFile`) on the next `pump`, instead of being found by `queue.indexOf` and removed by
// `splice` on each cancellation. Oracle of the immediate remove: `referenceRetireDeLaFile`, copied
// as-is from before batch G in `../../../../bench/oracles/browser/recherches-streaming.ts`.
{
  const { referenceRetireDeLaFile } =
    await import('../../../../bench/oracles/browser/recherches-streaming.ts');

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

  test('cancel, readmit then drain yield the same queue as an immediate remove', () => {
    const ancienne = ['a', 'b', 'c', 'd'].map(job);
    const nouvelle = ['a', 'b', 'c', 'd'].map(job);

    // Cancel 'b': the old one removes it at once, the new one only marks it.
    referenceRetireDeLaFile(
      ancienne,
      ancienne.find((j) => j.url === 'b')!,
    );
    const cible = nouvelle.find((j) => j.url === 'b')!;
    cible.state = 'dropped';

    // Readmit: a new request arrives while 'b' is still in the array on the new side.
    ancienne.push(job('e'));
    nouvelle.push(job('e'));

    // A second cancellation, on 'd' this time.
    referenceRetireDeLaFile(
      ancienne,
      ancienne.find((j) => j.url === 'd')!,
    );
    nouvelle.find((j) => j.url === 'd')!.state = 'dropped';

    // Drain: the new one finally compacts, in one pass.
    compacteFile(nouvelle);

    assert.deepEqual(urls(nouvelle), urls(ancienne));
    assert.deepEqual(urls(nouvelle), ['a', 'c', 'e']);
  });

  test('cancelling a job absent from the queue, or already marked, does not disturb compaction', () => {
    const queue = ['a', 'b'].map(job);
    const outsider = job('x');
    referenceRetireDeLaFile(queue, outsider); // absent: indexOf returns -1, nothing moves
    compacteFile(queue); // nothing marked: nothing moves either
    assert.deepEqual(urls(queue), ['a', 'b']);

    queue[0].state = 'dropped';
    compacteFile(queue);
    compacteFile(queue); // a second compaction on an already clean queue is a no-op
    assert.deepEqual(urls(queue), ['b']);
  });

  test('cancelling the whole queue empties it, like one-by-one removes', () => {
    const ancienne = ['p0', 'p1', 'p2', 'p3'].map(job);
    const nouvelle = ['p0', 'p1', 'p2', 'p3'].map(job);
    for (const j of [...ancienne]) referenceRetireDeLaFile(ancienne, j);
    for (const j of nouvelle) j.state = 'dropped';
    compacteFile(nouvelle);
    assert.deepEqual(urls(ancienne), []);
    assert.deepEqual(urls(nouvelle), []);
  });
}
