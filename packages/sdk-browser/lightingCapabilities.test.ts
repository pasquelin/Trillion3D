import assert from 'node:assert/strict';
import test from 'node:test';
import { lightingCapabilitiesOf } from './lightingCapabilities.ts';
import type { RenderBackend } from './backendTypes.ts';

/** Un moteur réduit aux seules méthodes que la capacité lit : rien d'autre n'entre dans la réponse. */
const backendOf = (parts: Partial<RenderBackend>) => ({ id: 'moteur', ...parts }) as RenderBackend;

test("un moteur qui ne relit pas le magasin ne déclare aucune capacité d'éclairage", () => {
  const capabilities = lightingCapabilitiesOf(backendOf({}));
  assert.deepEqual(
    { ...capabilities, reason: undefined },
    {
      sceneLights: false,
      lightingView: false,
      shadows: false,
      transforms: false,
      reason: undefined,
    },
  );
  // Le refus est nommé : c'est ce que l'hôte lit au lieu de déduire une panne d'une image noire.
  assert.match(capabilities.reason!, /moteur/);
});

test('un moteur qui relit le magasin applique lampes et vue, et ses ombres se déclarent', () => {
  const sansOmbre = lightingCapabilitiesOf(
    backendOf({ refreshSceneLights: () => {}, lighting: { shadows: false, reason: 'sans ombre' } }),
  );
  assert.deepEqual(sansOmbre, {
    sceneLights: true,
    lightingView: true,
    shadows: false,
    transforms: false,
    reason: 'sans ombre',
  });
  const avecOmbre = lightingCapabilitiesOf(
    backendOf({
      refreshSceneLights: () => {},
      setTransform: () => {},
      lighting: { shadows: true },
    }),
  );
  assert.deepEqual(avecOmbre, {
    sceneLights: true,
    lightingView: true,
    shadows: true,
    transforms: true,
  });
});

test("une déclaration d'ombres ne vaut rien sans la relecture du magasin", () => {
  const capabilities = lightingCapabilitiesOf(backendOf({ lighting: { shadows: true } }));
  assert.equal(capabilities.shadows, false);
});

test('le déplacement de nœud se lit dans la méthode, jamais dans une déclaration', () => {
  assert.equal(lightingCapabilitiesOf(backendOf({ setTransform: () => {} })).transforms, true);
});
