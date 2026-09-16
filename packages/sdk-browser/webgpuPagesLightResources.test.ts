// La vue `lit` demandée explicitement éclaire, même sans lampe : le contrat tourne et sort du noir,
// émissifs conservés. Auparavant `store.count > 0` la faisait retomber sur l'albédo brut, et une
// pièce qu'on venait d'éteindre s'affichait claire — l'extinction ne se voyait sur aucun pixel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore, type SceneLight } from '../sdk-core/index.ts';
import { wantsContractLighting } from './webgpuPagesLightResources.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const LAMPE: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [0, 2, 0],
  color: [1, 1, 1],
  intensity: 5,
  range: 10,
  castsShadow: false,
};

function banc() {
  const store = createSceneLightStore();
  return { store, rt: { lights: { store } } as unknown as WebgpuPagesRuntime };
}

test('vue `lit` sans lampe : le contrat éclaire quand même, l’image sort noire', () => {
  const b = banc();
  b.store.setView('lit');
  assert.equal(wantsContractLighting(b.rt), true);
});

test('éteindre la dernière lampe en vue `lit` ne rallume pas l’albédo', () => {
  const b = banc();
  b.store.setView('lit');
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), true);
  b.store.remove('l0');
  assert.equal(wantsContractLighting(b.rt), true, 'toujours éclairé, donc noir : c’est la règle');
});

test('`auto` garde son comportement : albédo tant qu’aucune lampe n’est déclarée', () => {
  const b = banc();
  assert.equal(wantsContractLighting(b.rt), false, 'auto sans lampe : albédo brut');
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), true, 'une lampe déclarée : l’éclairage réel s’impose');
  b.store.remove('l0');
  assert.equal(
    wantsContractLighting(b.rt),
    false,
    'et il repart à l’albédo quand il n’y en a plus',
  );
});

test('`unlit` reste la vue de diagnostic, lampes ou pas', () => {
  const b = banc();
  b.store.setView('unlit');
  assert.equal(wantsContractLighting(b.rt), false);
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), false);
});
