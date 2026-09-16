// La règle « matrice singulière » du moteur (`mathSingular.ts`), celle que `normalMatrix3` applique
// côté processeur et que le noyau WGSL d'`inverseTransposeWgsl.ts` applique côté carte. Ce fichier
// éprouve la RÈGLE seule ; ce qu'une matrice singulière devient est éprouvé dans `mathMatrix3.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SINGULAR_DETERMINANT,
  SINGULAR_DETERMINANT_WGSL,
  adjugateFactor,
  linearPartScale,
  normalizedLinearDeterminant,
} from './mathSingular.ts';

/** Une 4×4 colonne-major à partir de ses trois colonnes de partie linéaire. */
const lineaire = (a: number[], b: number[], c: number[]) =>
  Float64Array.from([...a, 0, ...b, 0, ...c, 0, 0, 0, 0, 1]);
const echelleUniforme = (s: number) => lineaire([s, 0, 0], [0, s, 0], [0, 0, s]);

test('le seuil ne juge pas l’échelle : une rotation d’échelle uniforme reste régulière de 1e-7 à 1e7', () => {
  // Le piège du seuil ABSOLU : le déterminant brut d'une échelle uniforme `s` vaut s³, donc 1e-21 à
  // s = 1e-7 — sous n'importe quel seuil absolu, alors que la matrice est parfaitement inversible.
  // Normalisée, la même matrice a toujours pour déterminant 1/27, quelle que soit son échelle.
  for (const s of [1e-7, 1e-4, 1, 1e4, 1e7]) {
    const m = echelleUniforme(s);
    const normalise = normalizedLinearDeterminant(m);
    assert.ok(
      Math.abs(normalise - 1 / 27) < 1e-15,
      `échelle ${s} : déterminant normalisé ${normalise} au lieu de 1/27`,
    );
    assert.equal(adjugateFactor(m, s * s * s), 1 / (s * s * s), `échelle ${s} : facteur régulier`);
  }
});

test('un déterminant brut non nul mais de forme dégénérée est déclaré singulier', () => {
  // Colonnes presque parallèles : le déterminant BRUT vaut 1e-19, donc `det === 0` était faux et le
  // facteur valait 1e19 ; le déterminant NORMALISÉ vaut 1e-19 / 27 ≈ 3,7e-21, sous le seuil.
  const m = lineaire([1, 0, 0], [1, 1e-19, 0], [0, 0, 1]);
  const brut = 1e-19;
  assert.notEqual(brut, 0, 'le déterminant brut n’est pas nul');
  assert.ok(
    Math.abs(normalizedLinearDeterminant(m)) <= SINGULAR_DETERMINANT,
    'normalisé sous seuil',
  );
  assert.equal(adjugateFactor(m, brut), 1, 'facteur singulier : l’adjointe telle quelle');
});

test('un déterminant exactement nul reste singulier, comme avant', () => {
  const m = lineaire([1, 0, 0], [2, 0, 0], [0, 0, 1]);
  assert.equal(normalizedLinearDeterminant(m), 0);
  assert.equal(adjugateFactor(m, 0), 1);
});

test('un déterminant brut annulé par compensation rend l’adjointe, même sur une forme régulière', () => {
  // La somme des six produits d'un déterminant 4×4 peut tomber sur zéro EXACT là où la même
  // matrice, colonnes divisées par leur échelle, garde un déterminant loin du seuil : les deux
  // arrondis ne sont pas le même. Le processeur divise par le déterminant BRUT — c'est ce qui lui
  // garde les bits de la référence sur toute matrice ordinaire —, et un diviseur nul ne rend rien :
  // l'adjointe seule, comme le moteur le faisait déjà avant cette règle. La carte, qui divise par le
  // déterminant normalisé, n'a pas ce cas.
  const m = echelleUniforme(1);
  assert.ok(
    Math.abs(normalizedLinearDeterminant(m)) > SINGULAR_DETERMINANT,
    'la forme est régulière',
  );
  assert.equal(adjugateFactor(m, 0), 1, 'déterminant brut nul : l’adjointe seule');
});

test('une échelle nulle, infinie ou NaN ne rend aucun facteur : l’adjointe est à remplacer', () => {
  const cas: Array<[string, Float64Array]> = [
    ['nulle', new Float64Array(16)],
    ['infinie', lineaire([Infinity, 0, 0], [0, 1, 0], [0, 0, 1])],
    ['NaN', lineaire([NaN, 0, 0], [0, 1, 0], [0, 0, 1])],
  ];
  for (const [quoi, m] of cas) {
    assert.ok(Number.isNaN(normalizedLinearDeterminant(m)), `${quoi} : déterminant normalisé NaN`);
    assert.equal(adjugateFactor(m, 1), null, `${quoi} : aucun facteur`);
  }
});

test('l’échelle est la somme des neuf valeurs absolues du bloc 3×3, translation exclue', () => {
  const m = Float64Array.from([1, -2, 3, 9, -4, 5, -6, 9, 7, -8, 9, 9, 100, 200, 300, 1]);
  assert.equal(linearPartScale(m), 45);
});

test('le seuil du WGSL est la constante rendue en texte, pas un second nombre', () => {
  assert.equal(Number(SINGULAR_DETERMINANT_WGSL), SINGULAR_DETERMINANT);
  assert.match(SINGULAR_DETERMINANT_WGSL, /^\d(\.\d+)?e[+-]\d+$/);
});
