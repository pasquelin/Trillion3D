// La variante d'EXPÉRIENCE de la métrique d'erreur écran : par défaut la nôtre, inchangée au bit
// près, et sur demande la projection simple de la référence externe, processeur et texte WGSL au
// même résultat. `screenErrorVariant.ts` porte la formule et sa source publique.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceScreenError,
  screenErrorBound,
  screenErrorVariant,
  setScreenErrorVariant,
} from './index.ts';

const CAS = [
  [0.05, 1, 0, 10, 1, 600, 0.1],
  [0.5, 1.25, 8, 12, 2, 900, 0.1],
  [7, 1, 40, 60, 3, 512, 0.05],
  [0.02, 2, 0.5, 3, 0.25, 700, 0.1],
] as const;

test('la variante par défaut est la nôtre, et la borne ne bouge pas d un bit', () => {
  assert.equal(screenErrorVariant(), 'certifiee');
  const avant = CAS.map((c) => screenErrorBound(...c));
  setScreenErrorVariant('reference');
  setScreenErrorVariant(null);
  assert.equal(screenErrorVariant(), 'certifiee');
  assert.deepEqual(
    CAS.map((c) => screenErrorBound(...c)),
    avant,
  );
  // À étirement ≥ 1, la borne certifiée reste au-dessus de la métrique de la référence : terme
  // latéral, étirement et déplacement au dénominateur sont autant de facteurs ≥ 1.
  for (const [error, stretch, lateral, depth, radius, focal, near] of CAS)
    assert.ok(
      screenErrorBound(error, stretch, lateral, depth, radius, focal, near) >=
        referenceScreenError(error, depth, focal, near),
      `borne sous la référence pour ε=${error}`,
    );
});

test('la variante reference rend erreur × focale / profondeur, l infini au plan proche', () => {
  setScreenErrorVariant('reference');
  try {
    assert.equal(screenErrorVariant(), 'reference');
    for (const [error, stretch, lateral, depth, radius, focal, near] of CAS)
      assert.equal(
        screenErrorBound(error, stretch, lateral, depth, radius, focal, near),
        (error * focal) / depth,
      );
    // Ni le rayon, ni l'étirement, ni la distance à l'axe n'entrent dans la métrique.
    assert.equal(screenErrorBound(0.5, 3, 40, 12, 9, 900, 0.1), (0.5 * 900) / 12);
    assert.equal(screenErrorBound(0.5, 1, 0, 0.05, 0, 900, 0.1), Infinity);
    assert.equal(screenErrorBound(0.5, 1, 0, -4, 0, 900, 0.1), Infinity);
  } finally {
    setScreenErrorVariant(null);
  }
});

test('une variante inconnue est refusée et ne remplace pas celle en place', () => {
  assert.throws(() => setScreenErrorVariant('rapide' as never), /Variante d erreur ecran inconnue/);
  assert.equal(screenErrorVariant(), 'certifiee');
});
