// Lot H2 : le pool borné de workers de module, prouvé avec de vrais fils `worker_threads` derrière
// `NodeDomWorker`. Entrées hostiles : un exécutant mort dès sa construction, un exécutant qui meurt
// après avoir démarré, une annulation sans effet sur un travail déjà réglé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageDecodePool } from './pageDecodePool.ts';
import {
  DeadNodeWorker,
  FlakyNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from './bench/oracles/pageDecodeNodeWorker.mjs';

test('l’épreuve de démarrage répond avant tout travail réel, même soumis dans la foulée', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const pool = createPageDecodePool(1);
    const ordre: string[] = [];
    const demarrage = pool.start().then((ok) => {
      ordre.push('demarrage');
      return ok;
    });
    // Soumis sans attendre l'épreuve : un seul worker existe, donc son travail attend en file.
    const decodage = pool.submit('decode', new ArrayBuffer(64), 1 << 20).answer.then((reponse) => {
      ordre.push('decodage');
      return reponse;
    });
    assert.equal(await demarrage, true);
    await decodage;
    assert.deepEqual(
      ordre,
      ['demarrage', 'decodage'],
      'le décodage a doublé l’épreuve de démarrage',
    );
    pool.retire();
  }));

test('un exécutant mort dès sa construction fait échouer le démarrage sans jamais bloquer', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const pool = createPageDecodePool(2);
    assert.equal(await pool.start(), false);
    assert.equal(pool.alive, false);
  }));

test('un exécutant qui meurt après un démarrage réussi répond PAGE_DECODE_WORKER au travail suivant', () =>
  withNodeWorkerShim(FlakyNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const pool = createPageDecodePool(1);
    assert.equal(await pool.start(), true, 'la première réponse doit réussir');
    assert.equal(pool.alive, true);
    const reponse = await pool.submit('decode', new ArrayBuffer(64), 1 << 20).answer;
    assert.equal(reponse.ok, false);
    assert.equal((reponse as { code: string }).code, 'PAGE_DECODE_WORKER');
    assert.equal(pool.alive, false, 'le pool doit être cassé après la mort du worker');
    // Un pool mort répond tout de suite, sans jamais tenter un nouvel exécutant.
    const apres = await pool.submit('decode', new ArrayBuffer(8), 1 << 20).answer;
    assert.equal((apres as { code: string }).code, 'PAGE_DECODE_WORKER');
  }));

test('annuler un identifiant inconnu ou déjà réglé ne fait rien et ne casse pas le pool', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const pool = createPageDecodePool(1);
    assert.equal(await pool.start(), true);
    const { id, answer } = pool.submit('verify', new ArrayBuffer(8), 0);
    await answer; // déjà réglé : plus de propriétaire.
    assert.doesNotThrow(() => pool.cancel(id));
    assert.doesNotThrow(() => pool.cancel(999999));
    assert.equal(pool.alive, true);
    pool.retire();
  }));
