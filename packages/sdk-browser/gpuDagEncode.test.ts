// Le contrat d'encodage de la coupe : le NOMBRE de commandes qu'une image ouvre, seul responsable de
// l'attente que les horodatages n'attribuent à aucun noyau. Il ne dépend NI de la profondeur de la
// hiérarchie NI du nombre de grappes : six, toujours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDagKernels } from './gpuDagEncode.ts';
import { encodeurTemoin, ressources, LIVE, CAND, DRAWN } from './gpuDagEncodeFixture.ts';

test("une image n'ouvre que six commandes, quelle que soit la profondeur", () => {
  // Ce que la carte paie entre deux noyaux ne se compte pas en fils mais en COMMANDES : chaque passe
  // de calcul et chaque copie hors passe ferment l'encodeur courant et en ouvrent un autre. Il y en
  // avait 3·profondeur+3 — 42 sur la hiérarchie de profondeur treize du banc —, parce que chaque
  // niveau se lançait indirectement et devait donc armer son argument. La descente se lance
  // désormais à plat, dans la passe de tête : trois copies d'armement et trois passes, un point.
  for (const levelCount of [1, 3, 5]) {
    const { encoder, copies, passes } = encodeurTemoin();
    encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true, levelCount));
    assert.equal(passes.length, 3, 'la tête, les candidates, les vivantes');
    assert.equal(copies.length, 3, 'un armement par liste dont le rangement ne sait rien');
    assert.equal(passes.length + copies.length, 6);
  }
});

test("l'argument de répartition est recopié hors passe, entre deux passes de la coupe", () => {
  const { encoder, copies, passes } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  // WebGPU refuse `work` à la fois en écriture et en argument dans une même portée : chaque armement
  // coupe donc la passe, et ne porte que le mot de tête, les deux autres valant un depuis la
  // création. Il n'en reste que trois, pour les trois listes dont le rangement ne connaît aucun
  // majorant : le journal des dessinées de l'image d'avant, les candidates et les vivantes.
  assert.deepEqual(copies, [
    { de: 'work', decalage: DRAWN, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: CAND, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: LIVE, vers: 'dispatchArgs', octets: 4, enPasse: false },
  ]);
  assert.deepEqual(passes, new Array(3).fill('WG DAG selection'));
});
