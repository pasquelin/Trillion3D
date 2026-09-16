import test from 'node:test';
import assert from 'node:assert/strict';
import { normalMatrix3 } from './mathMatrix3.ts';
import { dotVector3 } from './mathVector.ts';

test('normalMatrix3 : bloc identité affine rend l’identité 3×3', () => {
  const m = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
  const out = normalMatrix3(new Float64Array(9), m);
  assert.deepEqual([...out], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('normalMatrix3 : échelle non uniforme, diagonale réciproque terme à terme', () => {
  const m = Float64Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 5, 0, 1, 2, 3, 1]);
  const out = normalMatrix3(new Float64Array(9), m);
  assert.deepEqual([out[0], out[4], out[8]], [0.5, 1 / 3, 0.2]);
  assert.deepEqual([out[1], out[2], out[3], out[5], out[6], out[7]], [0, 0, 0, 0, 0, 0]);
});

test('normalMatrix3 : bloc singulier de rang 2 rend l’adjointe, la normale du plan d’arrivée', () => {
  // Colonne 1 = 2 × colonne 0 : bloc singulier, mais de rang 2. Les colonnes (1,0,0) et (0,0,1)
  // engendrent le plan XZ : la primitive y est APLATIE, ses faces y gardent une aire, et leur
  // normale monde est ±Y. L'adjointe l'écrit colonne par colonne — b × c = (0, −2, 0),
  // c × a = (0, 1, 0), a × b = 0 — et toute normale locale hors du noyau y tombe une fois
  // normalisée. La référence rendait neuf zéros, donc une surface sans normale du tout.
  const m = Float64Array.from([1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const out = normalMatrix3(new Float64Array(9).fill(9), m);
  assert.deepEqual([...out], [0, -2, 0, 0, 1, 0, 0, 0, 0]);
});

test('normalMatrix3 : rang 2, plusieurs normales de sommet distinctes tombent toutes sur la normale de la face', () => {
  // LE contre-exemple de l'audit : triangle local (0,0,0), (1,0,0), (0,1,0), échelle (1,1,0) puis
  // 90° autour de Y. Ry(90°) envoie x sur −z et z sur x ; composée avec diag(1,1,0), ses colonnes
  // sont (0,0,−1), (0,1,0), (0,0,0) — la primitive est aplatie sur le plan XY monde, arêtes
  // transformées (0,0,−1) et (0,1,0), produit vectoriel (1,0,0) : la normale de FACE est +X.
  const m = Float64Array.from([0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  const n = normalMatrix3(new Float64Array(9), m);
  // L'adjointe de rang 1 ne garde que la composante z de la normale locale (colonnes 0 et 1
  // nulles) : trois normales de sommet différentes, mais de composante z positive comme sur une
  // face qui n'a pas changé de côté, doivent toutes retomber sur +X une fois unitaires — la face
  // aplatie n'a plus qu'une seule normale, celle de la face, et le lissage par sommet disparaît.
  const normalesLocales: Array<[number, number, number]> = [
    [0, 0, 1],
    [0.5, 0.3, 0.8],
    [-0.2, 0.9, 0.4],
  ];
  for (const [x, y, z] of normalesLocales) {
    const rendue: [number, number, number] = [
      n[0] * x + n[3] * y + n[6] * z,
      n[1] * x + n[4] * y + n[7] * z,
      n[2] * x + n[5] * y + n[8] * z,
    ];
    const norme = Math.hypot(...rendue);
    assert.ok(norme > 0, `normale de sommet (${x},${y},${z}) : rendue nulle, ${rendue}`);
    assert.deepEqual(
      [rendue[0] / norme, rendue[1] / norme, rendue[2] / norme],
      [1, 0, 0],
      `normale de sommet (${x},${y},${z}) : ${rendue}, attendu la normale de face +X`,
    );
  }
});

test('normalMatrix3 : bloc effondré sur une droite rend la matrice nulle, faute de face', () => {
  // Les trois colonnes sur l'axe x : la primitive est écrasée sur une droite, aucune face n'y garde
  // d'aire, et les trois produits vectoriels de colonnes parallèles sont nuls d'eux-mêmes.
  const m = Float64Array.from([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1]);
  const out = normalMatrix3(new Float64Array(9).fill(9), m);
  assert.deepEqual([...out], new Array(9).fill(0));
});

test('normalMatrix3 : un déterminant brut non nul mais de forme dégénérée rend l’adjointe, comme le noyau WGSL', () => {
  // La règle unique du moteur (`mathSingular.ts`) juge le déterminant NORMALISÉ. Ici le déterminant
  // brut vaut 5e-324 — non nul, donc l'ancien test `det === 0` laissait passer —, mais son inverse
  // vaut l'infini : chaque terme sortait infini ou NaN. Normalisé, il tombe sous le seuil, donc
  // l'adjointe part telle quelle et la normale du plan d'arrivée survit. La carte décidait déjà
  // ainsi ; le processeur décide comme elle.
  const m = Float64Array.from([1, 0, 0, 0, 1, 5e-324, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const out = normalMatrix3(new Float64Array(9).fill(9), m);
  assert.deepEqual([...out], [5e-324, -1, 0, 0, 1, 0, 0, 0, 5e-324]);
  // La normale locale +Z reste portée sur +Z : le plan d'arrivée est bien retrouvé.
  const z: [number, number, number] = [out[6], out[7], out[8]];
  assert.ok(z[2] > 0 && z[0] === 0 && z[1] === 0, `normale de +Z : ${z}`);
});

test('normalMatrix3 : une échelle non finie rend neuf zéros, comme le noyau WGSL', () => {
  // Échelle nulle, infinie ou NaN : la 3×3 normalisée ne vaut rien, le noyau WGSL remplace alors son
  // adjointe par zéro, et le processeur fait de même. C'est un écart ASSUMÉ avec la bibliothèque de
  // référence, qui propageait des NaN ; une pose non finie est refusée à l'entrée du moteur
  // (`hostWorldMatrices.ts`), et rien de non fini ne doit repartir dans l'éclairage.
  for (const m of [
    Float64Array.from([NaN, 0, 0, 0, 0, -0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    Float64Array.from([Infinity, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  ])
    assert.deepEqual([...normalMatrix3(new Float64Array(9).fill(9), m)], new Array(9).fill(0));
});

test('normalMatrix3 : préserve la perpendicularité normale/tangente sous cisaillement', () => {
  // Cisaillement en x selon y : une normale et une tangente perpendiculaires dans l'espace objet
  // doivent le rester dans l'espace transformé une fois la normale portée par la matrice normale.
  const m = Float64Array.from([1, 0, 0, 0, 0.7, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const normaleObjet: [number, number, number] = [0, 1, 0];
  const tangenteObjet: [number, number, number] = [1, 0, 0];
  assert.equal(dotVector3(normaleObjet, tangenteObjet), 0);
  const n = normalMatrix3(new Float64Array(9), m);
  const normaleMonde: [number, number, number] = [
    n[0] * normaleObjet[0] + n[3] * normaleObjet[1] + n[6] * normaleObjet[2],
    n[1] * normaleObjet[0] + n[4] * normaleObjet[1] + n[7] * normaleObjet[2],
    n[2] * normaleObjet[0] + n[5] * normaleObjet[1] + n[8] * normaleObjet[2],
  ];
  const tangenteMonde: [number, number, number] = [
    m[0] * tangenteObjet[0] + m[4] * tangenteObjet[1] + m[8] * tangenteObjet[2],
    m[1] * tangenteObjet[0] + m[5] * tangenteObjet[1] + m[9] * tangenteObjet[2],
    m[2] * tangenteObjet[0] + m[6] * tangenteObjet[1] + m[10] * tangenteObjet[2],
  ];
  assert.ok(Math.abs(dotVector3(normaleMonde, tangenteMonde)) < 1e-12);
});
