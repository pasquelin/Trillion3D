// La règle de réflexion n'est plus écrite qu'une fois : `matrixWindingCw` remplace les
// `matrix.determinant() < 0` sur la 4×4 du raster CPU éclairé et de la passe de mélange.
//
// LES DEUX VERDICTS COMPARÉS, mot pour mot :
//   — `matrixWindingCw(m.elements)` : le signe du déterminant de la 3×3 supérieure gauche, développé
//     en f64 par cofacteurs sur la première ligne (`matrixOrientation.ts`) ;
//   — `m.determinant() < 0` : le signe du déterminant 4×4 complet de Three, développé sur les seize
//     coefficients.
// Sur une matrice monde affine — dernière ligne (0, 0, 0, 1) — les deux déterminants sont le MÊME
// nombre réel : les trois cofacteurs de la dernière ligne sont multipliés par zéro. Ils ne sont pas
// pour autant le même calcul flottant, et c'est là que la substitution peut se voir.
//
// CE QUE CE FICHIER MESURE, et ce qu'il ne mesure pas. Quatre populations, 2 400 000 matrices, AUCUN
// cas écarté d'aucune : un cas mesuré qui gêne est compté, jamais retiré de la population.
//   A. 1 000 000 de poses composées (position, rotation, échelle signée de 1e-3 à 1e3) : 0 désaccord.
//   B. 1 000 000 d'affines quelconques, cisaillement compris : 0 désaccord.
//   C.   200 000 SINGULIÈRES construites (3ᵉ colonne = combinaison des deux autres) : 62 069
//        désaccords, soit 31 % — c'est la population que le compte rendu précédent citait sans dire
//        qu'elle ne faisait pas partie du million. Les deux affirmations d'alors, « 1 000 000 de
//        matrices, 0 verdict différent » et « désaccords sur des singulières », portaient sur deux
//        populations distinctes ; réunies en une phrase, elles se contredisaient.
//   D.   200 000 à échelle aplatie (un axe exactement nul, ce qu'un importateur produit vraiment) :
//        0 désaccord — les deux déterminants valent zéro exactement, et `0 < 0` est faux des deux
//        côtés.
// Ce qu'il advient des singulières de C dans le moteur : rien ne les écarte. `matrixWindingCw` est
// lue telle quelle par `visibilityRaster`, `visibilityShadingNormal`, `webgpuPagesWinding` et
// `webgpuBlendDraw` pour choisir la face éliminée. Une matrice de rang 2 aplatit la primitive sur un
// plan qui reste VISIBLE : le verdict décide donc lequel de ses deux côtés est montré, et le
// désaccord y a bien une conséquence observable. Mais le déterminant mathématique de ces matrices
// est nul : les deux écritures n'y comparent que du bruit d'arrondi, et aucune des deux n'a raison
// contre l'autre. Le test borne ce bruit au lieu de l'excuser — voir le dernier test.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { matrixWindingCw } from './matrixOrientation.ts';

/** Suite déterministe : le même balayage à chaque exécution, sur cette machine et ailleurs. */
function tirage(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
    return etat / 4294967296;
  };
}

/**
 * Le conditionnement d'une pose : |det 3×3| rapporté au produit des normes de ses trois colonnes.
 * 1 pour une matrice orthogonale, 0 pour une singulière, indépendant de l'échelle. C'est la seule
 * façon de dire « cette matrice est singulière » sans lire une échelle : le déterminant brut d'une
 * rotation d'échelle 1e-3 vaut 1e-9 sans être dégénéré pour autant.
 */
function conditionnement(e: ArrayLike<number>) {
  const det =
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
    e[1] * (e[4] * e[10] - e[6] * e[8]) +
    e[2] * (e[4] * e[9] - e[5] * e[8]);
  const norme = (a: number, b: number, c: number) => Math.hypot(e[a], e[b], e[c]);
  const produit = norme(0, 1, 2) * norme(4, 5, 6) * norme(8, 9, 10);
  return produit > 0 ? Math.abs(det) / produit : 0;
}

/** Une population : `n` matrices remplies par `poser`, les deux verdicts comptés sur chacune. */
function balayage(n: number, graine: number, poser: (m: THREE.Matrix4, s: () => number) => void) {
  const suivant = tirage(graine);
  const m = new THREE.Matrix4();
  const releve = { n, cw: 0, desaccords: 0, pireConditionnementEnDesaccord: 0, pireAccord: 1 };
  for (let i = 0; i < n; i++) {
    poser(m, suivant);
    const cw = matrixWindingCw(m.elements);
    const reference = m.determinant() < 0;
    const conditionne = conditionnement(m.elements);
    if (cw) releve.cw++;
    if (cw === reference) releve.pireAccord = Math.min(releve.pireAccord, conditionne);
    else {
      releve.desaccords++;
      releve.pireConditionnementEnDesaccord = Math.max(
        releve.pireConditionnementEnDesaccord,
        conditionne,
      );
    }
  }
  return releve;
}

const position = new THREE.Vector3(),
  rotation = new THREE.Quaternion(),
  echelle = new THREE.Vector3(),
  euler = new THREE.Euler();

/** Position, rotation et échelle signée de 1e-3 à 1e3 : instances, miroirs et modèles importés. */
function poseComposee(m: THREE.Matrix4, s: () => number, aplatir: number | null = null) {
  position.set((s() - 0.5) * 2e3, (s() - 0.5) * 2e3, (s() - 0.5) * 2e3);
  euler.set((s() - 0.5) * 6.3, (s() - 0.5) * 6.3, (s() - 0.5) * 6.3);
  rotation.setFromEuler(euler);
  const taille = () => (s() < 0.5 ? -1 : 1) * Math.pow(10, (s() - 0.5) * 6);
  echelle.set(taille(), taille(), taille());
  if (aplatir !== null) echelle.setComponent(aplatir, 0);
  m.compose(position, rotation, echelle);
}

test('la règle est le signe du déterminant 3×3, pas une lecture d’échelle', () => {
  const identite = new THREE.Matrix4();
  assert.equal(matrixWindingCw(identite.elements), false);
  // Un seul axe retourné renverse l'orientation ; deux la rétablissent.
  const unMiroir = new THREE.Matrix4().makeScale(1, -1, 1);
  assert.equal(matrixWindingCw(unMiroir.elements), true);
  const deuxMiroirs = new THREE.Matrix4().makeScale(-1, -1, 1);
  assert.equal(matrixWindingCw(deuxMiroirs.elements), false);
  // Une rotation ne renverse rien, quelle que soit la translation qui l'accompagne.
  const tournee = new THREE.Matrix4()
    .makeRotationY(1.2)
    .premultiply(new THREE.Matrix4().makeTranslation(9, -4, 3));
  assert.equal(matrixWindingCw(tournee.elements), false);
});

test('A — 1 000 000 de poses composées : aucun verdict ne se sépare, aucun cas écarté', () => {
  const releve = balayage(1_000_000, 20260916, (m, s) => poseComposee(m, s));
  assert.equal(releve.desaccords, 0, `${releve.desaccords} désaccords sur ${releve.n} poses`);
  assert.ok(releve.cw > 4e5 && releve.cw < 6e5, 'le balayage doit contenir les deux verdicts');
  // Aucune pose composée d'échelles non nulles n'est singulière : rien à écarter, et rien d'écarté.
  assert.ok(releve.pireAccord > 1e-3, `pose quasi singulière inattendue : ${releve.pireAccord}`);
});

test('B — 1 000 000 d’affines quelconques, cisaillement compris : aucun verdict ne se sépare', () => {
  // La dernière ligne d'une matrice monde ne pèse pas : la partie linéaire seule décide.
  const releve = balayage(1_000_000, 7, (m, s) => {
    for (let colonne = 0; colonne < 4; colonne++)
      for (let ligne = 0; ligne < 4; ligne++)
        m.elements[colonne * 4 + ligne] =
          colonne === 3 ? (ligne === 3 ? 1 : (s() - 0.5) * 1e3) : ligne === 3 ? 0 : s() - 0.5;
  });
  assert.equal(releve.desaccords, 0, `${releve.desaccords} désaccords sur ${releve.n} affines`);
  assert.ok(releve.cw > 4e5 && releve.cw < 6e5, 'le balayage doit contenir les deux verdicts');
  // Le tirage descend jusqu'à 1e-7 de conditionnement sans séparer les deux écritures.
  assert.ok(releve.pireAccord < 1e-6, `tirage trop sage : pire accord à ${releve.pireAccord}`);
});

test('D — 200 000 échelles aplaties, un axe exactement nul : les deux verdicts sont faux', () => {
  const releve = balayage(200_000, 1234, (m, s) => poseComposee(m, s, Math.floor(s() * 3)));
  assert.equal(releve.desaccords, 0, `${releve.desaccords} désaccords sur ${releve.n} aplaties`);
  // Les deux déterminants valent zéro exactement : `0 < 0` est faux, donc aucun retournement.
  assert.equal(releve.cw, 0, 'une matrice d’échelle nulle ne doit renverser aucune orientation');
});

// C — la population qui sépare les deux écritures, comptée et bornée, jamais écartée. Une 3×3 dont
// la troisième colonne est combinaison des deux premières est singulière par construction : son
// déterminant réel est nul, et les deux écritures n'y comparent que leur propre bruit d'arrondi.
// Ce qui doit rester vrai, et que ce test tient : le désaccord ne franchit JAMAIS le bruit. Au-delà
// d'un conditionnement de 1e-15 — un millier de fois l'epsilon du f64 — les deux verdicts sont
// toujours d'accord, donc aucune matrice que le moteur peut encore montrer sous un côté déterminé
// ne change de face en passant d'une écriture à l'autre.
test('C — 200 000 singulières construites : le désaccord reste sous le bruit d’arrondi', () => {
  const releve = balayage(200_000, 99, (m, s) => {
    const c1 = [s() - 0.5, s() - 0.5, s() - 0.5];
    const c2 = [s() - 0.5, s() - 0.5, s() - 0.5];
    const a = (s() - 0.5) * 4,
      b = (s() - 0.5) * 4;
    m.identity();
    for (let k = 0; k < 3; k++) {
      m.elements[k] = c1[k];
      m.elements[4 + k] = c2[k];
      m.elements[8 + k] = a * c1[k] + b * c2[k];
      m.elements[12 + k] = (s() - 0.5) * 1e3;
    }
  });
  // Le désaccord existe : le dire, et le compter, plutôt que construire une population qui l'évite.
  assert.ok(
    releve.desaccords > 5e4,
    `la population doit rester celle qui sépare les deux écritures : ${releve.desaccords}`,
  );
  assert.ok(
    releve.pireConditionnementEnDesaccord < 1e-15,
    `un désaccord à ${releve.pireConditionnementEnDesaccord} de conditionnement : ce n'est plus du ` +
      'bruit d’arrondi, les deux écritures se séparent sur une matrice que le moteur peut montrer',
  );
});
