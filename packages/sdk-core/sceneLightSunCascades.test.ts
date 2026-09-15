// G8 : `sunCascadeOf` ne refait les bornes de cascade (`sunCascadeSplits`, quatre `Math.pow`) que
// si la vue ou la découpe ont changé depuis le dernier appel, au lieu de les refaire à chaque face.
// Oracle : la version d'avant le lot G, qui les refaisait toujours, recopiée telle quelle dans
// `bench/oracles/g-soleil.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunCascadeOf } from './sceneLightSunCascades.ts';
import { referenceSunCascadeOf } from './bench/oracles/g-soleil.mjs';
import type { ShadowViewpoint } from './sceneLightContracts.ts';

function view(overrides: Partial<ShadowViewpoint> = {}): ShadowViewpoint {
  return {
    position: [0, 5, 0],
    forward: [0, 0, -1],
    halfFovY: 0.6,
    aspect: 16 / 9,
    near: 0.1,
    far: 200,
    ...overrides,
  };
}

const AXIS: [number, number, number] = [0.1, -0.9, 0.4];

// `boxRadius` a quitté la cascade avec le lot des ombres par pages : le volume du rejet se calcule
// désormais à partir des demi-côtés de la boîte, pour pouvoir n'en prendre qu'une région. L'oracle,
// lui, reste la copie figée d'avant ; on compare donc les champs que la cascade publie encore.
function memeCascade(v: ShadowViewpoint, index: number, side: number, label: string) {
  const { center, radius, boxCenter } = sunCascadeOf(v, AXIS, index, side);
  const reference = referenceSunCascadeOf(v, AXIS, index, side);
  assert.deepEqual(
    { center: [...center], radius, boxCenter: [...boxCenter] },
    {
      center: [...reference.center],
      radius: reference.radius,
      boxCenter: [...reference.boxCenter],
    },
    label,
  );
}

test('les quatre cascades d’une même vue, appelées dans l’ordre, valent la référence sans cache', () => {
  const v = view();
  for (let index = 0; index < 4; index++) memeCascade(v, index, 1024, `cascade ${index}`);
});

test('un objet vue distinct mais aux mêmes valeurs déclenche quand même un résultat correct (cache par valeur)', () => {
  const v1 = view();
  memeCascade(v1, 0, 1024, 'premier objet');
  const v2 = view(); // nouvel objet, mêmes champs
  memeCascade(v2, 0, 1024, 'second objet, mêmes valeurs');
  memeCascade(v2, 3, 1024, 'second objet, dernière cascade');
});

test('la vue change entre deux images : les bornes changent aussi, sans rester sur l’ancien cache', () => {
  memeCascade(view({ far: 200 }), 1, 512, 'far=200');
  memeCascade(view({ far: 50 }), 1, 512, 'far=50, doit se recalculer');
  memeCascade(view({ near: 5 }), 1, 512, 'near=5, doit se recalculer');
  memeCascade(view({ far: 50 }), 1, 512, 'retour à far=50');
});

test('un side minuscule, nul ou négatif ne fait pas diverger la grille de texels', () => {
  const v = view();
  for (const side of [1, 0, -4, 0.0001]) memeCascade(v, 2, side, `side ${side}`);
});

test('-0 et 0 en near/far ne sont pas confondus par le cache : le résultat suit toujours la référence', () => {
  memeCascade(view({ near: 0 }), 0, 800, 'near 0');
  memeCascade(view({ near: -0 }), 0, 800, 'near -0');
  memeCascade(view({ far: -0 }), 0, 800, 'far -0');
});

test('une vue avec NaN ou un axe dégénéré ne casse rien et reste identique à la référence', () => {
  memeCascade(view({ far: NaN }), 0, 800, 'far NaN');
  memeCascade(view({ halfFovY: 0 }), 1, 800, 'halfFovY nul');
  memeCascade(view({ aspect: 0 }), 1, 800, 'aspect nul');
});
