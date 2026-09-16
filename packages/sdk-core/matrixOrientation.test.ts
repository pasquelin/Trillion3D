// La règle de réflexion n'est plus écrite qu'une fois : `matrixWindingCw` remplace les
// `matrix.determinant() < 0` sur la 4×4 du raster CPU éclairé et de la passe de mélange. Ce qui doit
// être vrai pour que ce remplacement ne change aucune image : sur une matrice monde affine non
// dégénérée, le déterminant 3×3 et le déterminant 4×4 rendent le MÊME verdict.
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

test('même verdict que le déterminant 4×4 sur toute pose monde non dégénérée', () => {
  const suivant = tirage(20260916);
  const m = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    echelle = new THREE.Vector3();
  const euler = new THREE.Euler();
  const signe = () => (suivant() < 0.5 ? -1 : 1);
  let miroirs = 0;
  for (let i = 0; i < 20000; i++) {
    position.set((suivant() - 0.5) * 2e3, (suivant() - 0.5) * 2e3, (suivant() - 0.5) * 2e3);
    euler.set((suivant() - 0.5) * 6.3, (suivant() - 0.5) * 6.3, (suivant() - 0.5) * 6.3);
    rotation.setFromEuler(euler);
    // Échelles de 1/1000 à 1000, retournées ou non : instances, miroirs et modèles importés.
    const taille = () => signe() * Math.pow(10, (suivant() - 0.5) * 6);
    echelle.set(taille(), taille(), taille());
    m.compose(position, rotation, echelle);
    const cw = matrixWindingCw(m.elements);
    if (cw) miroirs++;
    assert.equal(cw, m.determinant() < 0, `pose ${i} : les deux écritures se séparent`);
  }
  assert.ok(miroirs > 5000 && miroirs < 15000, 'le balayage doit contenir les deux verdicts');
});

test('la 4×4 d’une matrice monde n’ajoute rien : sa dernière ligne ne pèse pas', () => {
  const suivant = tirage(7);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 5000; i++) {
    // Affine quelconque, cisaillement compris : la partie linéaire seule décide.
    for (let colonne = 0; colonne < 4; colonne++)
      for (let ligne = 0; ligne < 4; ligne++)
        m.elements[colonne * 4 + ligne] =
          colonne === 3
            ? ligne === 3
              ? 1
              : (suivant() - 0.5) * 1e3
            : ligne === 3
              ? 0
              : suivant() - 0.5;
    assert.equal(matrixWindingCw(m.elements), m.determinant() < 0, `matrice ${i}`);
  }
});
