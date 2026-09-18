import test from 'node:test';
import assert from 'node:assert/strict';
import { textureJob, type TextureJob } from './webgpuAtlasJobs.ts';
import { createTextureReads, MAX_FAILURES, MAX_FETCHES } from './webgpuTextureReads.ts';

/** Un niveau cuit dont la lecture est pilotée par le test : `resolve` ou `reject` la termine. */
function readJob(level: number, slot = 1) {
  let settle: { resolve: () => void; reject: (e: unknown) => void } | undefined;
  const job: TextureJob = {
    ...textureJob('color', { slot, classIndex: 0, layer: slot }, level, 0, 2, 8, () => {}),
    ready: false,
    fetch: () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve: () => ((job.ready = true), resolve()), reject };
      }),
  };
  return { job, settle: () => settle! };
}
const tick = () => new Promise((done) => setTimeout(done, 0));

// Comportement 1 : au plus six lectures en vol, prises dans l'ordre de la file ; un travail déjà
// prêt ou déjà en lecture n'en lance pas une seconde.
test('au plus six lectures en vol, dans l’ordre de la file, une par travail', () => {
  const entries = Array.from({ length: 9 }, (_, i) => readJob(i));
  const jobs = entries.map((e) => e.job);
  const reads = createTextureReads({ jobs, onFailure: () => {}, onAbandon: () => {} });
  reads.prefetch();
  assert.deepEqual(
    jobs.map((job) => job.fetching ?? false),
    [true, true, true, true, true, true, false, false, false],
  );
  reads.prefetch();
  assert.equal(jobs.filter((job) => job.fetching).length, 6, 'un second passage ne double rien');
});

// Comportement 2 : une lecture aboutie rend le travail prêt et compte ; `settled` attend les
// lectures en vol et vaut `null` quand il n'y en a aucune.
test('une lecture aboutie rend le travail prêt, et settled attend les lectures en vol', async () => {
  const a = readJob(2),
    b = readJob(1);
  const reads = createTextureReads({
    jobs: [a.job, b.job],
    onFailure: () => {},
    onAbandon: () => {},
  });
  assert.equal(reads.settled(), null);
  reads.prefetch();
  const waiting = reads.settled();
  assert.ok(waiting, 'deux lectures en vol');
  a.settle().resolve();
  b.settle().resolve();
  await waiting;
  assert.deepEqual([a.job.ready, b.job.ready, reads.fetched], [true, true, 2]);
  assert.equal(reads.settled(), null);
});

// Comportement 2 bis : un niveau lu dont le transfert n'est pas fini tient son image décodée en
// mémoire, donc il compte dans le plafond — sans quoi une file plus rapide à lire qu'à transférer
// accumulerait des images sans borne.
test('un niveau lu et pas encore transféré occupe une place du plafond', async () => {
  const entries = Array.from({ length: MAX_FETCHES + 2 }, (_, i) => readJob(i));
  const jobs = entries.map((e) => e.job);
  const reads = createTextureReads({ jobs, onFailure: () => {}, onAbandon: () => {} });
  reads.prefetch();
  for (const entry of entries.slice(0, MAX_FETCHES)) entry.settle().resolve();
  await reads.settled();
  reads.prefetch();
  assert.deepEqual(
    jobs.map((job) => job.ready || job.fetching === true),
    [...Array(MAX_FETCHES).fill(true), false, false],
    'six niveaux lus, aucun de plus lancé tant qu’ils ne sont pas transférés',
  );
  jobs.splice(0, 2);
  reads.prefetch();
  assert.deepEqual(
    jobs.map((job) => job.ready || job.fetching === true),
    Array(MAX_FETCHES).fill(true),
    'deux niveaux transférés ont quitté la file : deux lectures partent',
  );
});

// Comportement 3 : une lecture qui échoue est signalée et retentée ; au troisième échec le
// travail quitte la file, avec sa raison.
test('trois lectures échouées sortent le travail de la file, avec la raison read-failed', async () => {
  const entry = readJob(0);
  const jobs = [entry.job];
  const failures: string[] = [],
    abandons: Array<[number, string]> = [];
  const reads = createTextureReads({
    jobs,
    onFailure: (phase) => failures.push(phase),
    onAbandon: (job, reason) => abandons.push([job.level, reason]),
  });
  for (let attempt = 1; attempt <= MAX_FAILURES; attempt++) {
    reads.prefetch();
    entry.settle().reject(new Error('réseau'));
    await tick();
    assert.equal(entry.job.failures, attempt);
    assert.equal(entry.job.fetching, false);
  }
  assert.deepEqual(failures, Array(MAX_FAILURES).fill('texture-level-read-failed'));
  assert.deepEqual(abandons, [[0, 'read-failed']]);
  assert.equal(jobs.length, 0, 'le travail a quitté la file');
});
