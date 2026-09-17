// Cas parent/enfant du socle : de vraies chaînes `Object3D` de `three`, mises à jour par
// `updateMatrixWorld(true)`, recomposées nœud par nœud avec `composeMatrix4` et `multiplyMatrix4`
// (`chainesHostiles`, déjà écrite pour le banc du lot, réutilisée ici pour la vérité bit à bit).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chainesHostiles,
  lectureReference,
  lectureSocle,
} from '../sdk-browser/bench/appui/socleHierarchie.mjs';

const CHAMPS = [
  'matrixWorld',
  'position monde',
  'quaternion monde',
  'échelle monde',
  'déterminant',
  'signe du déterminant',
  'matrice normale',
  'inverse',
];

/** `Object.is` composante par composante ; `NaN` accepté des deux côtés à la même place. */
function memeValeurs(a: unknown, b: unknown, chemin: string) {
  if (typeof a === 'number') {
    assert.ok(Object.is(a, b), `${chemin} : ${a} ≠ ${b}`);
    return;
  }
  const ta = a as ArrayLike<number>,
    tb = b as ArrayLike<number>;
  assert.equal(ta.length, tb.length, chemin);
  for (let i = 0; i < ta.length; i++)
    assert.ok(Object.is(ta[i], tb[i]), `${chemin}[${i}] : ${ta[i]} ≠ ${tb[i]}`);
}

test('chaînes parent/enfant hostiles : la fixture couvre bien les cas exigés', () => {
  const noeuds = chainesHostiles();
  assert.ok(noeuds.length > 100, `${noeuds.length} nœuds, jeu trop petit`);

  const profondeur = (n: (typeof noeuds)[number]) => {
    let p = n,
      d = 0;
    while (p.parent >= 0) {
      p = noeuds[p.parent];
      d++;
    }
    return d;
  };
  assert.ok(Math.max(...noeuds.map(profondeur)) >= 3, 'aucune chaîne de profondeur ≥ 3');

  const enfantsPar = new Map<number, number>();
  for (const n of noeuds)
    if (n.parent >= 0) enfantsPar.set(n.parent, (enfantsPar.get(n.parent) ?? 0) + 1);
  assert.ok(
    [...enfantsPar.values()].some((c) => c >= 2),
    'aucune branche à deux enfants ou plus',
  );

  assert.ok(
    noeuds.some((n) => n.echelle.filter((c) => c < 0).length === 1),
    'aucune échelle négative sur un seul axe',
  );
  assert.ok(
    noeuds.some((n) => [...n.echelle].some((c) => c === 0)),
    'aucune échelle nulle',
  );
  assert.ok(
    noeuds.some(
      (n) =>
        n.parent >= 0 &&
        noeuds[n.parent].rotation.some((c, i) => c !== (i === 3 ? 1 : 0)) &&
        new Set(n.echelle).size > 1,
    ),
    'aucun nœud à échelle non uniforme sous une rotation parente',
  );
});

test('chaînes parent/enfant hostiles : monde, position, quaternion, échelle, déterminant, normale et inverse — bit à bit contre `three`', () => {
  const noeuds = chainesHostiles();
  for (const [index, n] of noeuds.entries()) {
    const ref = lectureReference(n),
      socle = lectureSocle(n);
    for (let champ = 0; champ < CHAMPS.length; champ++)
      memeValeurs(ref[champ], socle[champ], `nœud ${index}, ${CHAMPS[champ]}`);
  }
});
