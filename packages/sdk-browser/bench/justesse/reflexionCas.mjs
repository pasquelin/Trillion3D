// Défaut 10 : ce que le moteur dessine vraiment sous une transformation de déterminant négatif.
//
// Le lot du défaut 6 a laissé 54 suppressions de faces « visibles », toutes des réflexions, et a
// proposé comme lecture que `cross(M·e1,M·e2) = det(M)·M⁻ᵀ·n` change de signe, donc que l'axe du
// cône devrait être multiplié par `sign(det)`. Sa vérité terrain (`veriteTerrain`) est l'orientation
// géométrique BRUTE des sommets transformés, qui ignore que le moteur, lui, échange la face
// éliminée sous réflexion — `windingCw` en WebGPU, `frontFaceCW = determinant() < 0` dans Three en
// WebGL. Ce module oppose les deux vérités : la brute et celle du moteur, mesurée en fragments
// réellement couverts par la rasterisation.
import * as THREE from 'three';
import { windingCw } from '../../webgpuPagesWinding.ts';
import { camera } from './inverseTransposeCas.mjs';

const TRIANGLES = [
  [0, 1, 2],
  [3, 4, 5],
];
/** Une vue carrée assez fine pour que chaque cas couvre des milliers de pixels, assez petite pour
 *  que les 6 916 rasterisations CPU et GPU tiennent en quelques secondes. */
export const VUE = [128, 128];

/** Le cas vu comme une page du tampon de visibilité : une face avant, deux triangles, sa matrice. */
export function pageVisible(cas) {
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', new THREE.Float32BufferAttribute(cas.positions, 3));
  return {
    array: new Uint32Array(cas.indices),
    attributes: geometrie.attributes,
    matrix: cas.world,
    material: new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  };
}

/** La matrice `viewProj` de la caméra partagée, en colonne-major, telle que le moteur l'assemble. */
export function viewProjection() {
  camera.updateWorldMatrix(true, false);
  return [
    ...new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .elements,
  ];
}

/**
 * Le sens de parcours que le moteur appliquerait à ce cas : sa propre fonction `windingCw`, sur un
 * enregistrement de page qui ne porte que la matrice monde. Rien n'est réécrit ici.
 */
export function sensDuMoteur(cas) {
  return windingCw({ matrix: cas.world }) ? 'cw' : 'ccw';
}

/**
 * La charge de `rasterGpu` pour une liste de cas : les sommets transformés en double précision —
 * la question posée est l'orientation, pas l'arrondi — groupés par sens de parcours, un slot de
 * compteur par cas.
 */
export function chargeRaster(cas) {
  const groupes = { ccw: [], cw: [] };
  for (let i = 0; i < cas.length; i++) groupes[sensDuMoteur(cas[i])].push(i);
  const sommets = [];
  const bornes = [];
  for (const sens of ['ccw', 'cw']) {
    const debut = sommets.length / 4;
    for (const i of groupes[sens])
      for (const triangle of TRIANGLES)
        for (const sommet of triangle) {
          const p = new THREE.Vector3()
            .fromArray(cas[i].positions, sommet * 3)
            .applyMatrix4(cas[i].world);
          sommets.push(p.x, p.y, p.z, i);
        }
    bornes.push([sens, debut, sommets.length / 4 - debut]);
  }
  return {
    sommets,
    bornes,
    viewProj: viewProjection(),
    largeur: VUE[0],
    hauteur: VUE[1],
    slots: cas.length,
  };
}
