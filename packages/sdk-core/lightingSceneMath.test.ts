// Lot F, F20 : `length` (lightingSceneMath.ts) et la norme d'une normale de facette
// (lightingTransportValidation.ts) sont la même formule, passée d'un étalement d'arguments
// (`Math.hypot(...v)`) à trois arguments positionnels. `multiply4` (sceneLightShadowFaces.ts) passe
// de trois boucles imbriquées avec accumulateur à seize sommes écrites à la main. Les oracles sont
// les implémentations d'avant le lot F, recopiées telles quelles dans `oracles/f-vecteurs.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { length } from './lightingSceneMath.ts';
import { multiply4 } from './sceneLightShadowFaces.ts';
import { validateScene } from './lightingTransportValidation.ts';
import { sceneWithBlocker } from '../../test/fixtures/lightingTransportScene.ts';
import {
  referenceLength,
  referenceMultiply4,
} from '../../scripts/mesure/calculs/oracles/f-vecteurs.mjs';
import type { Vec3 } from './lightingSceneTypes.ts';

test('length rend exactement Math.hypot(...v) sur des vecteurs hostiles', () => {
  const vecteurs: Vec3[] = [
    [0, 0, 0],
    [-0, -0, -0],
    [1, 0, 0],
    [NaN, 0, 0],
    [Infinity, -Infinity, 0],
    [1e308, 1e308, 1e308],
    [-3, 4, 0],
    [Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE],
  ];
  for (const v of vecteurs)
    assert.ok(
      Object.is(length(v), referenceLength(v)),
      `length(${v}) = ${length(v)} ≠ référence ${referenceLength(v)}`,
    );
});

test('multiply4 rend exactement la même matrice que les trois boucles imbriquées, tampons partagés compris', () => {
  const cas: Float32Array[][] = [
    [
      Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
      Float32Array.from({ length: 16 }, (_, i) => i),
    ],
    [Float32Array.from({ length: 16 }, () => 0), Float32Array.from({ length: 16 }, () => 0)],
    [Float32Array.from({ length: 16 }, () => NaN), Float32Array.from({ length: 16 }, (_, i) => i)],
    [
      Float32Array.from({ length: 16 }, () => Infinity),
      Float32Array.from({ length: 16 }, () => -Infinity),
    ],
    [Float32Array.from({ length: 16 }, () => -0), Float32Array.from({ length: 16 }, () => 1)],
  ];
  for (const [a, b] of cas) {
    const outA = new Float32Array(16),
      scratchA = new Float32Array(16);
    multiply4(outA, 0, a, 0, b, 0, scratchA);
    const outB = new Float32Array(16),
      scratchB = new Float32Array(16);
    referenceMultiply4(outB, 0, a, 0, b, 0, scratchB);
    for (let i = 0; i < 16; i++)
      assert.ok(Object.is(outA[i], outB[i]), `mot ${i} : ${outA[i]} ≠ référence ${outB[i]}`);
  }
  // `out` peut être le même tampon que `a` (ou `b`) : la doc du contrat l'autorise, `scratch` reste
  // le tampon intermédiaire qui rend cet alias possible.
  const shared = Float32Array.of(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2);
  const b = Float32Array.from({ length: 16 }, (_, i) => i + 1);
  const refOut = new Float32Array(16);
  referenceMultiply4(refOut, 0, shared, 0, b, 0, new Float32Array(16));
  multiply4(shared, 0, shared, 0, b, 0, new Float32Array(16));
  for (let i = 0; i < 16; i++)
    assert.ok(
      Object.is(shared[i], refOut[i]),
      `aliasé (out=a), mot ${i} : ${shared[i]} ≠ ${refOut[i]}`,
    );
});

test('validateScene accepte toujours une normale de facette à la limite de tolérance (1e-6)', () => {
  // `lightingTransportValidation.ts` appelle la même formule que `length` sur `patch.normal` : une
  // scène déjà valide, dont les normales sont unitaires par construction, doit continuer de passer.
  const scene = sceneWithBlocker(true, 1);
  assert.doesNotThrow(() => validateScene(scene));
  for (const patch of scene.patches)
    assert.ok(
      Object.is(length(patch.normal), referenceLength(patch.normal)),
      `norme de la normale du patch ${patch.id}`,
    );
});
