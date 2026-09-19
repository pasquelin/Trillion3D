// Lot H2 : l'hôte du décodage — comptabilité des octets, borne du pool, démarrage jamais attendu,
// et les métriques `null` tant que rien n'est mesuré. Entrées hostiles : un exécutant mort, une page
// résidente dont le tampon partagé ne doit ni bouger ni être détaché.
//
// L'épreuve de démarrage du pool n'est jamais attendue par le code lui-même (`void pool.start()...`) :
// elle règle `started` de façon asynchrone, bien après le retour de l'appel qui l'a déclenchée. Un
// test qui rendrait la main avant qu'elle ne se règle laisserait cette résolution tardive écraser
// l'état d'un pool déjà relâché par le test suivant ; chaque test qui touche le pool attend donc que
// le fil principal cesse de servir avant de le relâcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageDecodeWorkerCount } from '../sdk-core/index.ts';
import {
  configurePageDecoders,
  decodePageOffThread,
  pageDecodeStats,
  releasePageDecoders,
  verifyPageBytes,
} from './pageDecodeHost.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';
import {
  DeadNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from './bench/oracles/pageDecodeNodeWorker.mjs';

async function page() {
  const { data } = await encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  });
  return data as Uint8Array;
}

function avecCoeurs<T>(n: number, run: () => Promise<T>) {
  const precedent = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: n },
    configurable: true,
  });
  return run().finally(() => {
    if (precedent) Object.defineProperty(globalThis, 'navigator', precedent);
  });
}

/** Decodes again until the pool really serves one decode off the main thread, or gives up at the
 *  deadline. The only reliable way to know that the startup trial — asynchronous, never awaited —
 *  has settled. The deadline is wide: a Node worker takes a few hundred milliseconds to start on a
 *  loaded CI runner, and the loop stops at the first served decode. */
async function jusquAuPool(delaiMs = 10_000) {
  const limite = Date.now() + delaiMs;
  do {
    await decodePageOffThread(await page());
    if (pageDecodeStats().offThread! > 0) return true;
    await new Promise((r) => setTimeout(r, 10));
  } while (Date.now() < limite);
  return false;
}

test('sans aucun décodage, les métriques valent null, pas zéro', () => {
  releasePageDecoders();
  assert.deepEqual(pageDecodeStats(), {
    offThread: null,
    wasm: null,
    decodeMs: null,
    workers: null,
  });
});

test('une page résidente n’est jamais détachée : sa vue partielle est copiée, pas transférée', async () => {
  releasePageDecoders(); // pas de `Worker` ici : force le repli sur le fil principal (`ownBuffer`).
  const donnees = await page();
  const accueil = new Uint8Array(donnees.byteLength + 16);
  accueil.set(donnees, 8); // une vue partielle, comme une entrée du cache de pages.
  const vue = accueil.subarray(8, 8 + donnees.byteLength);
  const decodee = await decodePageOffThread(vue);
  assert.equal(decodee.vertexCount, 3);
  assert.equal(accueil.buffer.byteLength, donnees.byteLength + 16, 'le tampon du cache a bougé');
  for (let i = 0; i < donnees.byteLength; i++)
    assert.equal(vue[i], donnees[i], `octet ${i} altéré`);
});

test('la taille du pool est bornée par les cœurs, le plafond et l’admission, lisible dans les métriques', () =>
  withNodeWorkerShim(NodeDomWorker, () =>
    avecCoeurs(8, async () => {
      releasePageDecoders();
      configurePageDecoders(2);
      assert.ok(await jusquAuPool(), 'le pool devait finir par servir un décodage');
      assert.equal(pageDecodeStats().workers, pageDecodeWorkerCount(8, 2));
      releasePageDecoders();
    }),
  ));

test('un exécutant mort au démarrage n’empêche jamais le décodage de finir, ni ne bloque', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    const decodee = await decodePageOffThread(await page());
    assert.equal(decodee.vertexCount, 3);
    assert.equal(await jusquAuPool(500), false, 'un pool mort ne doit jamais finir par servir');
    assert.equal(pageDecodeStats().workers, 0);
    releasePageDecoders();
  }));

test('l’épreuve de démarrage n’est jamais attendue : le premier appel passe par le fil principal', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    await decodePageOffThread(await page());
    assert.equal(pageDecodeStats().offThread, 0, 'le premier appel n’a pas dû attendre le pool');
    assert.ok(await jusquAuPool(), 'une fois démarré, le pool doit finir par servir un appel');
    releasePageDecoders();
  }));

test('une page fraîche vérifiée est transférée : son tampon d’origine se vide après l’appel', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    releasePageDecoders();
    configurePageDecoders(1);
    assert.ok(await jusquAuPool(), 'le pool doit être prêt avant la vérification qui compte');
    const donnees = await page();
    const source = donnees.slice().buffer as ArrayBuffer;
    const { sha256, source: rendu } = await verifyPageBytes(source);
    assert.equal(source.byteLength, 0, 'le tampon cédé doit être détaché après le transfert');
    assert.equal(rendu.byteLength, donnees.byteLength);
    assert.equal(sha256.length, 64);
    releasePageDecoders();
  }));
