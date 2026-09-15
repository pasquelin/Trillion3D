// Lot F, F20 : `length` (lightingSceneMath.ts) et la norme d'une normale de facette
// (lightingTransportValidation.ts) sont la même formule, passée d'un étalement d'arguments
// (`Math.hypot(...v)`) à trois arguments positionnels. Le point F20 sur `multiply4`
// (sceneLightShadowFaces.ts) est sans objet : le lot ombres, sur develop, a réécrit ce fichier et
// supprimé la fonction avant que ce worktree ne rebase dessus. L'oracle est l'implémentation d'avant
// le lot F, recopiée telle quelle dans `oracles/f-vecteurs.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { length } from './lightingSceneMath.ts';
import { validateScene } from './lightingTransportValidation.ts';
import { sceneWithBlocker } from '../../test/fixtures/lightingTransportScene.ts';
import { referenceLength } from '../../scripts/mesure/calculs/oracles/f-vecteurs.mjs';
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
