// Lot M4a, hostSceneLightState.ts : la cible d'une lampe conique ou directionnelle est résolue par
// `resolveHostNode` puis `hostWorldPositionInto` (hostWorldMatrices.ts) au lieu d'un accès direct à
// Three. Confronté au bit près (Object.is) à `getWorldPosition`, ancêtres périmés compris.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LIGHT_SLOTS, readLightInto } from './hostSceneLightState.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

test('readLightInto résout la position monde de la cible comme getWorldPosition, sous une hiérarchie hostile périmée', () => {
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
  // La racine devient périmée sans être remise à jour : `resolveHostNode` doit la reprendre.
  racine.position.set(9, 9, 9);

  const light = new THREE.SpotLight();
  (light as unknown as { target: THREE.Object3D }).target = cible;
  const held = new Float64Array(LIGHT_SLOTS);
  readLightInto(light, held, 0);

  const attendu = new THREE.Vector3();
  cible.getWorldPosition(attendu); // recalcule aussi la chaîne des ancêtres, comme resolveHostNode
  assertBits(held.subarray(11, 14), [attendu.x, attendu.y, attendu.z]);
});

test('readLightInto : une lampe sans cible rend une position de cible nulle', () => {
  const light = new THREE.PointLight();
  const held = new Float64Array(LIGHT_SLOTS);
  readLightInto(light, held, 0);
  assertBits(held.subarray(11, 14), [0, 0, 0]);
});

test('readLightInto : les propriétés absentes d’un type de lampe valent zéro (DirectionalLight n’a ni distance ni cône)', () => {
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

test('readLightInto rend `moved` vrai puis faux, et écrit à partir du décalage `at`', () => {
  const light = new THREE.SpotLight(0x112233, 1.5, 10, Math.PI / 4, 0.3, 1.7);
  const held = new Float64Array(LIGHT_SLOTS * 2);
  assert.equal(readLightInto(light, held, LIGHT_SLOTS), true, 'première écriture : ça bouge');
  assert.equal(readLightInto(light, held, LIGHT_SLOTS), false, 'rien n’a changé depuis');
  assert.equal(held[0], 0, 'rien avant le décalage');
  assert.equal(held[LIGHT_SLOTS + 4], 10, 'distance écrite au bon décalage');
  assert.equal(held[LIGHT_SLOTS + 6], Math.PI / 4, 'angle écrit au bon décalage');
});
