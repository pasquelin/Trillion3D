import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTexturePump } from './webgpuTexturePump.ts';
import { createTextureBudget } from './textureBudget.ts';
import { textureJob, type TextureJob } from './webgpuAtlasJobs.ts';

/** Un plafond que rien n'atteint : ce banc éprouve la file, pas le registre d'octets. */
const OPEN_LEDGER = { budget: Number.MAX_SAFE_INTEGER, allocated: () => 0, scoreOf: () => 0 };
const tick = () => new Promise((done) => setTimeout(done, 0));

/** Un niveau cuit du slot 1 : lu quand `resolve` est appelé, transféré en une bande de deux lignes. */
function levelJob(level: number, log: string[]) {
  let resolve = () => {};
  const place = { slot: 1, classIndex: 0, layer: 1 };
  const upload = (row: number, count: number) => log.push(`niveau ${level} lignes ${row}+${count}`);
  const job: TextureJob = {
    ...textureJob('data', place, level, 0, 2, 8, upload),
    ready: false,
    pyramid: { first: 0, last: 3 },
    fetch: () =>
      new Promise<void>((done) => {
        resolve = () => {
          job.ready = true;
          done();
        };
      }),
  };
  return { job, resolve: () => resolve() };
}

/** Une pompe sur `jobs`, sans atlas ni budget d'octets, dont la connaissance de l'écran se pilote. */
function buildPump(
  jobs: TextureJob[],
  screenKnown: () => boolean,
  onLevel: (kind: string, slot: number, level: number) => void = () => {},
) {
  return createWebgpuTexturePump({
    device: { queue: {} } as unknown as GPUDevice,
    jobs,
    budget: 1 << 20,
    colorAtlas: () => undefined,
    dataAtlas: () => undefined,
    ledger: createTextureBudget(OPEN_LEDGER),
    order: () => {},
    onResident: () => {},
    screenKnown,
    onLevel,
    onReady: () => {},
    onFailure: () => {},
    onAbandon: () => {},
  });
}

// Comportement : un niveau dont les octets ne sont pas là est sauté, sans bloquer un niveau prêt
// derrière lui ; une fois lu, il part à la pompe suivante, et `onLevel` reçoit son atlas.
test('un niveau non lu ne bloque pas la file, et part dès qu’il est lu, avec son atlas', async () => {
  const log: string[] = [];
  const coarse = levelJob(3, log),
    fine = levelJob(2, log);
  const jobs = [fine.job, coarse.job];
  const levels: Array<[string, number, number]> = [];
  const pump = buildPump(
    jobs,
    () => true,
    (kind, slot, level) => levels.push([kind, slot, level]),
  );
  pump.pump();
  assert.deepEqual(log, [], 'rien n’est prêt : rien ne part, et les deux lectures sont lancées');
  assert.equal(
    jobs.every((job) => job.fetching),
    true,
  );
  // `settled` attend TOUTES les lectures en vol ; ici une seule aboutit, donc on laisse passer les
  // micro-tâches de sa promesse sans attendre l'autre.
  coarse.resolve();
  await tick();
  pump.pump();
  assert.deepEqual(log, ['niveau 3 lignes 0+2'], 'le niveau lu part, celui qui attend est sauté');
  assert.deepEqual(levels, [['data', 1, 3]]);
  assert.equal(pump.fetched, 1);
  fine.resolve();
  await pump.settled();
  pump.pump();
  assert.deepEqual(log, ['niveau 3 lignes 0+2', 'niveau 2 lignes 0+2']);
  assert.equal(jobs.length, 0, 'la file est vide');
});

// Comportement : avant la première caméra, aucun niveau cuit n'est lu — l'écran n'a pas encore dit
// lequel sert, et lire le niveau 0 d'une texture au hasard coûterait réseau et décodage pour rien.
// La barrière, elle, lit : elle doit converger, caméra ou non.
test('avant la première caméra aucun niveau cuit n’est lu ; la barrière lit quand même', () => {
  const log: string[] = [];
  const jobs = [levelJob(3, log).job];
  let known = false;
  const pump = buildPump(jobs, () => known);
  pump.pump();
  assert.equal(jobs[0].fetching, undefined, 'écran inconnu : pas de lecture');
  known = true;
  pump.pump();
  assert.equal(jobs[0].fetching, true, 'écran connu : la lecture part');
  const barrier = [levelJob(2, log).job];
  buildPump(barrier, () => false).pump(true);
  assert.equal(barrier[0].fetching, true, 'barrière : la lecture part sans caméra');
});
