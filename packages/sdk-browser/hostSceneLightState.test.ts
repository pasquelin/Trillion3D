// Batch M4a, hostSceneLightState.ts: the target of a cone or directional light is resolved by
// `resolveHostNode` then `hostWorldPositionInto` (hostWorldMatrices.ts) instead of a direct
// Three access. Compared bit-for-bit (Object.is) to `getWorldPosition`, stale ancestors included.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LIGHT_SLOTS, readLightInto } from './hostSceneLightState.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

test('readLightInto resolves the target world position like getWorldPosition, under a stale hostile hierarchy', () => {
  const racine = new THREE.Group();
  racine.scale.set(-2, 1, 1);
  const enfant = new THREE.Group();
  enfant.position.set(3, 0, 0);
  racine.add(enfant);
  const petitEnfant = new THREE.Group();
  petitEnfant.position.set(0, 5, 0);
  enfant.add(petitEnfant);
  const cible = new THREE.Object3D();
  cible.position.set(1, 1, 1);
  petitEnfant.add(cible);
  racine.updateMatrixWorld(true);
  // The root becomes stale without being updated: `resolveHostNode` must take it again.
  racine.position.set(9, 9, 9);

  const light = new THREE.SpotLight();
  (light as unknown as { target: THREE.Object3D }).target = cible;
  const held = new Float64Array(LIGHT_SLOTS);
  readLightInto(light, held, 0);

  const attendu = new THREE.Vector3();
  cible.getWorldPosition(attendu); // also recomputes the ancestor chain, like resolveHostNode
  assertBits(held.subarray(11, 14), [attendu.x, attendu.y, attendu.z]);
});

test('readLightInto: a light without a target returns a null target position', () => {
  const light = new THREE.PointLight();
  const held = new Float64Array(LIGHT_SLOTS);
  readLightInto(light, held, 0);
  assertBits(held.subarray(11, 14), [0, 0, 0]);
});

test('readLightInto: properties a light type lacks are zero (DirectionalLight has neither distance nor cone)', () => {
  const light = new THREE.DirectionalLight(0xff8040, 2);
  const held = new Float64Array(LIGHT_SLOTS);
  readLightInto(light, held, 0);
  assert.equal(held[4], 0, 'distance');
  assert.equal(held[5], 0, 'decay');
  assert.equal(held[6], 0, 'angle');
  assert.equal(held[7], 0, 'penumbra');
  assert.equal(held[8], 0, 'groundColor.r');
  assertBits(held.subarray(0, 3), [light.color.r, light.color.g, light.color.b]);
  assert.equal(held[3], light.intensity);
});

test('readLightInto returns `moved` true then false, and writes from the `at` offset', () => {
  const light = new THREE.SpotLight(0x112233, 1.5, 10, Math.PI / 4, 0.3, 1.7);
  const held = new Float64Array(LIGHT_SLOTS * 2);
  assert.equal(readLightInto(light, held, LIGHT_SLOTS), true, 'first write: it moved');
  assert.equal(readLightInto(light, held, LIGHT_SLOTS), false, 'nothing has changed since');
  assert.equal(held[0], 0, 'nothing before the offset');
  assert.equal(held[LIGHT_SLOTS + 4], 10, 'distance written at the right offset');
  assert.equal(held[LIGHT_SLOTS + 6], Math.PI / 4, 'angle written at the right offset');
});
