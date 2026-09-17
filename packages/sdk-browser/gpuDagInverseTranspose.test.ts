// Défaut 6 (seuil de `inverseTranspose3`, gpuDagShader.ts) : la dégénérescence d'une 3×3 se juge
// sur son déterminant NORMALISÉ, jamais sur le déterminant brut. Un seuil absolu juge l'échelle :
// une rotation d'échelle uniforme s a pour déterminant ±s³, donc s ≲ 2,15e-7 passait sous 1e-20 et
// le noyau rendait l'axe local non tourné — le rejet par cône supprimait alors des faces de face.
// Le comportement GPU réel est prouvé par `test/inverseTransposeePetiteEchelle.browser.mjs` ; ce
// test-ci rejoue la même arithmétique en f32 pour que `pnpm test` attrape la régression sans GPU.
// Le modèle f32 vit dans `bench/justesse/inverseTransposeF32.mjs`, partagé avec la preuve
// d'éclairage : une seule écriture de l'arithmétique, rattachée au shader réellement exécuté par
// `test/normalTransformArithmetique.browser.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
import { SINGULAR_DETERMINANT_WGSL } from '../sdk-core/index.ts';
import { INVERSE_TRANSPOSE_AVANT_WGSL, INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import {
  angleEntre,
  apresLeLot,
  avantLeLot,
  f,
  unitaire,
} from './bench/justesse/inverseTransposeF32.mjs';

type Vec = [number, number, number];

/** Rotation de 180° autour de X, échelle uniforme s : l'axe local (0,0,1) doit devenir (0,0,-1). */
const tourneeDe180 = (s: number): [Vec, Vec, Vec] => [
  [f(s), 0, 0],
  [0, f(-s), 0],
  [0, 0, f(-s)],
];
const AXE: Vec = [0, 0, 1];

test('le seuil absolu rendait l’axe local dès que s³ passait sous 1e-20', () => {
  assert.deepEqual(unitaire(avantLeLot(tourneeDe180(1e-3), AXE)), [0, 0, -1]);
  assert.deepEqual(unitaire(avantLeLot(tourneeDe180(1e-8), AXE)), [0, 0, 1]);
});

test('le noyau livré tourne l’axe à toute échelle, de 1e6 à 1e-18', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-6, 2e-7, 1e-7, 1e-8, 1e-12, 1e-16, 1e-18])
    assert.deepEqual(unitaire(apresLeLot(tourneeDe180(s), AXE)), [0, 0, -1], `échelle ${s}`);
});

// La normalisation change l'arrondi f32 de quelques ULP : la direction rendue hors de la bande du
// seuil n'est donc pas bit à bit celle d'avant, elle lui est colinéaire à 1e-6 radian près. Ce qui
// compte est la décision de rejet, mesurée nulle part changée hors bande sur GPU réel — voir
// `bench/justesse/inverse-transposee-petite-echelle.mjs`.
test('hors de la bande du seuil, la direction rendue est celle d’avant à 1e-6 radian près', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-4, 1e-5, 1e-6])
    for (const axe of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.6, -0.8, 0],
    ] as Vec[]) {
      const m = tourneeDe180(s);
      const ecart = angleEntre(apresLeLot(m, axe), avantLeLot(m, axe));
      assert.ok(ecart < 1e-6, `échelle ${s} axe ${axe} : écart ${ecart} rad`);
    }
});

test('3×3 nulle, infinie ou NaN : adjointe mise à zéro, donc vecteur nul, jamais le local', () => {
  const nulle: [Vec, Vec, Vec] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  assert.deepEqual(apresLeLot(nulle, AXE), [0, 0, 0]);
  for (const valeur of [Infinity, -Infinity, NaN]) {
    const abimee = tourneeDe180(1);
    abimee[0][0] = valeur;
    assert.deepEqual(apresLeLot(abimee, AXE), [0, 0, 0]);
  }
});

// Une colonne nulle n'efface pas la primitive : elle l'écrase sur un PLAN, où l'axe de cône garde
// une direction. `tourneeDe180(1e-8)` privée de sa colonne y a pour colonnes (1e-8, 0, 0), (0,0,0)
// et (0, 0, −1e-8) : le plan d'arrivée est XZ, et l'adjointe de la 3×3 normalisée vaut
// mat3(0, (0, −0,25, 0), 0). Appliquée à l'axe local (0,0,1) elle rend le vecteur NUL — l'axe local
// est dans le noyau —, appliquée à (0, 1, 0) elle rend (0, −0,25, 0), soit −Y une fois unitaire.
// L'ancien repli rendait l'axe LOCAL non tourné dans les deux cas.
test('une colonne nulle : l’adjointe porte la normale du plan, pas l’axe local', () => {
  const colonneNulle = tourneeDe180(1e-8);
  colonneNulle[1] = [0, 0, 0];
  assert.deepEqual(apresLeLot(colonneNulle, AXE), [0, 0, 0]);
  assert.deepEqual(unitaire(apresLeLot(colonneNulle, [0, 1, 0])), [0, -1, 0]);
});

// La normalisation, le déterminant et l'adjointe ne dépendent que de la matrice : ils vivent dans
// `invTranspose3Prep`, calculée une fois là où plusieurs vecteurs subissent la même matrice. Le
// jugement de dégénérescence n'a pas bougé de place pour autant — c'est lui que ce test tient.
test('le shader livré ne porte plus de seuil absolu sur le déterminant brut', () => {
  const corps = DAG_SELECTION_SHADER.split('fn invTranspose3Prep')[1].split('\n}')[0];
  assert.doesNotMatch(corps, /abs\(det\)<1e-20/, 'seuil absolu sur le determinant brut');
  assert.match(corps, /let a=m\[0\]\/t;let b=m\[1\]\/t;let c=m\[2\]\/t;/, 'normalisation absente');
  assert.match(corps, /fini&&abs\(det\)>1e-20/, 'garde relative absente');
  // Et ce nombre n'est pas écrit dans le nuanceur : il vient de la constante partagée avec le
  // processeur (`mathSingular.ts`), rendue en texte. Un seuil changé d'un seul côté est impossible.
  assert.equal(SINGULAR_DETERMINANT_WGSL, '1e-20', 'le seuil rendu n’est plus celui du nuanceur');
  assert.match(
    corps,
    new RegExp(`fini&&abs\\(det\\)>${SINGULAR_DETERMINANT_WGSL}`),
    'seuil partagé',
  );
  assert.match(
    corps,
    /let fini=\(t>0\.0\)&&\(bitcast<u32>\(t\)&0x7f800000u\)!=0x7f800000u;/,
    'somme nulle, infinie ou NaN non écartée',
  );
  assert.match(
    DAG_SELECTION_SHADER,
    /let porte=p\.adj\*v;\n return select\(porte,p\.facteur\*porte,p\.regulier\);/,
    'une matrice singulière doit rendre l’adjointe, pas le vecteur local ni un facteur infini',
  );
  assert.match(
    corps,
    /select\(z,cross\(b,c\),fini\),select\(z,cross\(c,a\),fini\),select\(z,cross\(a,b\),fini\)/,
    'une somme non finie doit annuler l’adjointe : `m/t` n’y vaut plus rien',
  );
});

// La forme d'avant le défaut 6 vit contre le noyau livré (`inverseTransposeWgsl.ts`), pour que le
// banc de reproduction la substitue au lieu de la reconstruire par un `String.replace` sur une copie
// verbatim — copie qui cessait de correspondre dès que le noyau changeait, sans que personne le
// voie. Une reproduction qui ne reproduit plus rassure à tort : ce test tient ce qui fait sa valeur,
// le seuil absolu sur la 3×3 brute, présent d'un côté et absent de l'autre. La substitution
// elle-même est établie, et non supposée, par `bench/justesse/substitutionAvant.mjs`. Le GPU réel
// est mesuré par `bench/justesse/inverse-transposee-petite-echelle.mjs`, qui sépare les suppressions
// de faces que le moteur dessine (656 avant le lot, 0 après) de celles qu'il ne dessine pas.
test('la forme de reproduction du défaut 6 porte encore le seuil absolu, et elle seule', () => {
  const prep = (texte: string) => texte.split('fn invTranspose3Prep')[1].split('\n}')[0];
  assert.match(prep(INVERSE_TRANSPOSE_AVANT_WGSL), /abs\(det\)<1e-20/, 'seuil absolu');
  assert.doesNotMatch(prep(INVERSE_TRANSPOSE_AVANT_WGSL), /let a=m\[0\]\/t/, 'normalisée');
  assert.doesNotMatch(prep(INVERSE_TRANSPOSE_WGSL), /abs\(det\)<1e-20/, 'seuil absolu revenu');
  // Les deux formes ne diffèrent qu'en DEUX endroits, et il faut les deux : la préparation, et le
  // repli d'une matrice singulière. Le défaut était de rendre le vecteur LOCAL — c'est ce que la
  // forme d'avant doit continuer à faire, sans quoi la reproduction rendrait la normale corrigée au
  // beau milieu du défaut. Tout le reste est le même texte, d'où la substitution du bloc entier.
  const repli = (texte: string) =>
    texte.split('let porte=p.adj*v;')[1].split(';')[0].replace('\n return select(', '');
  assert.equal(repli(INVERSE_TRANSPOSE_AVANT_WGSL), 'v,p.facteur*porte,p.regulier)');
  assert.equal(repli(INVERSE_TRANSPOSE_WGSL), 'porte,p.facteur*porte,p.regulier)');
  const suite = (texte: string) => texte.slice(texte.indexOf('fn inverseTranspose3'));
  assert.equal(suite(INVERSE_TRANSPOSE_AVANT_WGSL), suite(INVERSE_TRANSPOSE_WGSL));
});
