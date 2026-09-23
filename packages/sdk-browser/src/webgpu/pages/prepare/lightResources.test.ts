// An explicitly requested `lit` view lights, even with no light: the contract runs and outputs
// black, emissives kept. Previously `store.count > 0` fell back to raw albedo, and a room just
// switched off displayed bright — the blackout showed on no pixel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore, type SceneLight } from '../../../../../sdk-core/src/index.ts';
import { followLightThreshold, wantsContractLighting } from './lightResources.ts';
import { createWebgpuLightState } from '../state/lights.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

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

test('`lit` view with no light: the contract still lights, the image comes out black', () => {
  const b = banc();
  b.store.setView('lit');
  assert.equal(wantsContractLighting(b.rt), true);
});

test('turning off the last light in a `lit` view does not bring albedo back', () => {
  const b = banc();
  b.store.setView('lit');
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), true);
  b.store.remove('l0');
  assert.equal(wantsContractLighting(b.rt), true, 'always lit, therefore black: that is the rule');
});

test('`auto` keeps its behaviour: albedo while no light is declared', () => {
  const b = banc();
  assert.equal(wantsContractLighting(b.rt), false, 'auto with no light: raw albedo');
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), true, 'a declared light: real lighting takes over');
  b.store.remove('l0');
  assert.equal(
    wantsContractLighting(b.rt),
    false,
    'and it falls back to albedo when there are none left',
  );
});

test('`unlit` stays the diagnostic view, lights or not', () => {
  const b = banc();
  b.store.setView('unlit');
  assert.equal(wantsContractLighting(b.rt), false);
  b.store.add({ ...LAMPE });
  assert.equal(wantsContractLighting(b.rt), false);
});

test('a new light-cut threshold stales every shadow page, an unchanged one none', () => {
  const lights = createWebgpuLightState();
  const staled = () => lights.plan.deferredChanges;
  assert.equal(followLightThreshold(lights, 1, 0), 1);
  assert.equal(staled(), false, 'the first threshold draws the maps, it stales nothing');
  assert.equal(followLightThreshold(lights, 1, 0.5), 1);
  assert.equal(staled(), false, 'a budget under the threshold changes nothing');
  assert.equal(followLightThreshold(lights, 8, 0), 8);
  assert.equal(staled(), true, 'a coarser threshold waits for the camera to rest, everywhere');
});
