// Lot F, F20 : `length` (lightingSceneMath.ts) et la norme d'une normale de facette
// (lightingTransportValidation.ts) sont la même formule, passée d'un étalement d'arguments
// (`Math.hypot(...v)`) à trois arguments positionnels. Le point F20 sur `multiply4`
// (sceneLightShadowFaces.ts) est sans objet : le lot ombres, sur develop, a réécrit ce fichier et
// supprimé la fonction avant que ce worktree ne rebase dessus. L'oracle est l'implémentation d'avant
// le lot F, recopiée telle quelle dans `oracles/vecteurs-transport.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cross, length } from './lightingSceneMath.ts';
import { validateScene } from './lightingTransportValidation.ts';
import { sceneWithBlocker } from '../../test/fixtures/lightingTransportScene.ts';
import { referenceLength } from './bench/oracles/vecteurs-transport.mjs';
import { referenceCross } from '../sdk-browser/bench/oracles/socle-math.mjs';
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

// `cross` est passée d'un produit vectoriel écrit en ligne à `crossVector3` du socle mathématique.
// La formule est identique terme à terme (pas de somme initialisée à zéro dans un cas comme dans
// l'autre), donc aucune régression de zéro signé n'est attendue ici, à la différence des produits
// matrice × matrice testés dans `sceneLightShadowMath.test.ts` et `streamingPriority.test.ts`.
test('cross rend exactement le produit vectoriel d’avant, zéros signés compris', () => {
  const vecteurs: Vec3[] = [
    [1, 0, 0],
    [0, -0, 1],
    [-0, 0, -0],
    [3, -4, 0],
    [Infinity, -Infinity, 0],
    [NaN, 1, 1],
  ];
  for (const a of vecteurs)
    for (const b of vecteurs) {
      const recu = cross(a, b),
        attendu = referenceCross(a, b);
      for (let i = 0; i < 3; i++)
        assert.ok(
          Object.is(recu[i], attendu[i]),
          `cross(${a}, ${b})[${i}] = ${recu[i]} ≠ ${attendu[i]}`,
        );
    }
});
