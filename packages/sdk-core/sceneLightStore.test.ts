// Une mutation qui repose les valeurs déjà tenues n'est pas un changement. L'hôte qui renvoie ses
// lampes fixes à chaque image — le cas courant d'une boucle de banc — ne doit rien périmer : ni la
// révision de la lampe, que l'ordonnanceur d'ombres lit pour refaire ses pages, ni l'époque du
// magasin, que l'image relit pour repousser son tampon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from './sceneLightStore.ts';
import type { SceneLight } from './sceneLightContracts.ts';

const LAMPE: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 4,
  range: 10,
  castsShadow: true,
};

test('une lampe reposée à l’identique ne monte ni sa révision ni l’époque', () => {
  const store = createSceneLightStore();
  const slot = store.add({ ...LAMPE });
  const epoch = store.epoch,
    revision = store.revision[slot];
  // Les tableaux sont de nouvelles instances : c'est l'égalité des valeurs qui doit trancher.
  for (let i = 0; i < 10; i++)
    store.set('l0', { position: [1, 2, 3], color: [1, 0.5, 0.25], intensity: 4, range: 10 });
  assert.equal(store.epoch, epoch, 'dix mutations identiques, aucune époque publiée');
  assert.equal(store.revision[slot], revision, 'et aucune page d’ombre périmée');
});

test('un seul nombre qui change publie bien le changement', () => {
  const store = createSceneLightStore();
  const slot = store.add({ ...LAMPE });
  const epoch = store.epoch,
    revision = store.revision[slot];
  store.set('l0', { intensity: 4.5 });
  assert.equal(store.epoch, epoch + 1);
  assert.equal(store.revision[slot], revision + 1);
  assert.equal(store.light('l0')!.intensity, 4.5);
  // Une composante de tableau compte autant qu'un champ simple.
  store.set('l0', { position: [1, 2, 3.5] });
  assert.equal(store.epoch, epoch + 2);
  assert.deepEqual(store.light('l0')!.position, [1, 2, 3.5]);
});

test('une extinction par le drapeau d’ombre reste un changement', () => {
  const store = createSceneLightStore();
  store.add({ ...LAMPE });
  const epoch = store.epoch;
  store.set('l0', { castsShadow: false });
  assert.equal(store.epoch, epoch + 1);
  store.set('l0', { castsShadow: false });
  assert.equal(store.epoch, epoch + 1, 'reposé deux fois, publié une seule');
});

test('l’environnement suit la même règle que les lampes', () => {
  const store = createSceneLightStore();
  store.setEnvironment({ exposure: 1.5 });
  const epoch = store.epoch;
  store.setEnvironment({ exposure: 1.5 });
  assert.equal(store.epoch, epoch, 'une exposition reposée telle quelle ne périme pas l’image');
  store.setEnvironment({ exposure: 1.6 });
  assert.equal(store.epoch, epoch + 1);
  assert.equal(store.environment!.exposure, 1.6);
});

test('la vue éclairée sans lampe n’est plus une vue d’albédo', () => {
  const store = createSceneLightStore();
  assert.equal(store.unlit, true, 'auto sans lampe : albédo brut, c’est le défaut');
  store.setView('lit');
  assert.equal(store.unlit, false, 'lit demandée explicitement : le contrat éclaire, donc noir');
  store.setView('unlit');
  assert.equal(store.unlit, true);
});
