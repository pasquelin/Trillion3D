// Le contrat d'encodage de la coupe : le NOMBRE de commandes qu'une image ouvre, seul responsable de
// l'attente que les horodatages n'attribuent à aucun noyau. Il ne dépend que de la profondeur de la
// hiérarchie, jamais du nombre de grappes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDagKernels } from './gpuDagEncode.ts';
import { encodeurTemoin, ressources, LIVE, QUEUE, CAND, DRAWN } from './gpuDagEncodeFixture.ts';

test("une image n'ouvre plus que deux fois la profondeur en commandes, et non trois", () => {
  // Ce que la carte paie entre deux noyaux ne se compte pas en fils mais en COMMANDES : chaque passe
  // de calcul et chaque copie hors passe vide la file et les caches. Sur la hiérarchie du banc, de
  // profondeur treize, il y en avait 3·13+3 = 42 ; les files tournant à trois, la remise à zéro
  // quitte le processeur et il en reste 2·13+4 = 30.
  for (const levelCount of [3, 5, 13]) {
    const { encoder, copies, passes } = encodeurTemoin();
    encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true, levelCount));
    assert.equal(
      passes.length,
      levelCount + 2,
      'une passe par niveau, plus la tête et les deux fins',
    );
    assert.equal(
      copies.length,
      levelCount + 2,
      'une copie par lancement indirect, et rien de plus',
    );
    assert.equal(passes.length + copies.length, 2 * levelCount + 4);
    // Plus une seule copie vers `work` : ce qui y repart de zéro, le noyau s'en charge.
    assert.deepEqual(
      copies.filter((copie) => copie.vers !== 'dispatchArgs'),
      [],
    );
  }
});

test("l'argument de répartition est recopié hors passe, entre deux passes de la coupe", () => {
  const { encoder, copies, passes } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  // WebGPU refuse `work` à la fois en écriture et en argument dans une même portée : chaque armement
  // coupe donc la passe, et ne porte que le mot de tête, les deux autres valant un depuis la
  // création. Une copie par lancement indirect, et RIEN d'autre : la remise à zéro de la file que le
  // niveau suivant remplira est faite par le noyau lui-même, les files tournant à trois.
  assert.deepEqual(copies, [
    { de: 'work', decalage: DRAWN, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: QUEUE[1], vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: QUEUE[2], vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: CAND, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: LIVE, vers: 'dispatchArgs', octets: 4, enPasse: false },
  ]);
  assert.deepEqual(passes, new Array(5).fill('WG DAG selection'));
});
