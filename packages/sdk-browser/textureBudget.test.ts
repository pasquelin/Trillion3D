import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureBudget } from './textureBudget.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';

/** Les chiffres d'Emerald, relevés sur le banc 15 : 114 couches couleur et 222 couches de données
 *  de 2048², atlas alloués d'avance pour 7,56 Go, budget de résidence de l'appareil 4,29 Go. */
const SIDE = 2048,
  BYTES_PER_ROW = SIDE * 4,
  LAYERS = 336,
  ALLOCATED = 7_560_931_576,
  DEVICE_BUDGET = 4 * 1024 * 1024 * 1024;

/** Le niveau 0 d'une couche : le seul transfert qui rend une texture nette. */
const level0 = (slot: number): TextureJob => ({
  kind: 'color',
  slot,
  classIndex: 0,
  layer: slot,
  level: 0,
  stage: 1,
  score: 0,
  bytes: SIDE * BYTES_PER_ROW,
  rows: SIDE,
  bytesPerRow: BYTES_PER_ROW,
  nextRow: 0,
  failures: 0,
  uploadRows: () => {},
});

/**
 * Combien de couches un registre laisse passer en entier, la file étant parcourue dans son ordre.
 * Une couche transférée quitte la file, comme la pompe la retire : rien ne reste en vol derrière
 * elle, donc rien n'est évinçable — c'est l'état d'une scène posée, image après image.
 */
function admitted(ledger: ReturnType<typeof createTextureBudget>, jobs: TextureJob[]) {
  let transferred = 0;
  for (let at = 0; at < jobs.length;) {
    const job = jobs[at];
    if (!ledger.admits(job, jobs, false)) {
      at++;
      continue;
    }
    job.nextRow = job.rows;
    ledger.commit(job.bytes);
    jobs.splice(at, 1);
    transferred++;
  }
  return transferred;
}

test('le budget ne s’oppose jamais aux octets que les atlas ont déjà alloués : les 336 couches d’Emerald deviennent nettes', () => {
  const jobs = Array.from({ length: LAYERS }, (_, index) => level0(index + 1));
  const ledger = createTextureBudget({
    budget: DEVICE_BUDGET,
    allocated: () => ALLOCATED,
    scoreOf: (job) => job.slot,
  });
  assert.equal(admitted(ledger, jobs), LAYERS);
  assert.equal(jobs.length, 0, 'la file se vide, donc l’image finit par être tenue');
  assert.equal(
    ledger.budget,
    ALLOCATED,
    'le plafond publié est l’allocation, pas le nombre de l’appareil',
  );
  assert.ok(
    ledger.committed > DEVICE_BUDGET,
    'les 5,6 Go transférés dépassent le budget de l’appareil',
  );
  assert.equal(ledger.evictions, 0);
});

test('sans allocation connue, une couche refusée l’est définitivement : rien n’est en vol à évincer', () => {
  const jobs = Array.from({ length: LAYERS }, (_, index) => level0(index + 1));
  const ledger = createTextureBudget({
    budget: DEVICE_BUDGET,
    allocated: () => 0,
    scoreOf: (job) => job.slot,
  });
  const passed = admitted(ledger, jobs);
  assert.ok(passed < LAYERS, 'le budget de l’appareil arrête la file avant la dernière couche');
  assert.equal(jobs.length, LAYERS - passed, 'les couches refusées restent en file');
  // Deuxième passage : la file est figée, aucune image suivante ne la débloquera.
  assert.equal(admitted(ledger, jobs), 0);
});

test('`flush` lève le plafond : la file converge même au-dessus de l’allocation', () => {
  const job = level0(1);
  const ledger = createTextureBudget({ budget: 1, allocated: () => 0, scoreOf: () => 0 });
  assert.equal(ledger.admits(job, [job], false), false);
  assert.equal(ledger.admits(job, [job], true), true);
});
