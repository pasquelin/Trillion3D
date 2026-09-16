// Les charges du banc de performance du socle, préparées hors chronomètre. Chaque ligne fait le même
// travail des deux côtés : mêmes entrées, sorties déjà allouées, et une référence tenue dans ses
// propres objets comme le moteur la tient aujourd'hui.
import * as THREE from 'three';
import {
  composeMatrix4,
  decomposeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
  normalMatrix3,
  transformAffinePoint,
} from '../../sdk-core/index.ts';
import { REGLAGES, mesure } from './socleMesure.mjs';
import { hierarchie } from './socleHierarchie.mjs';
import { f64 } from './socleLigne.mjs';
import { lot, vueProjection } from './soclePerfLot.mjs';

/** Une opération seule, répétée sur 256 entrées tournantes. */
function seule(ligne, three, socle) {
  const n = REGLAGES.operationsSeules;
  return mesure({
    ligne,
    charge: 'opération seule',
    operations: n,
    three: () => {
      for (let i = 0; i < n; i++) three(i & 255);
    },
    socle: () => {
      for (let i = 0; i < n; i++) socle(i & 255);
    },
  });
}

function lignesSeules() {
  const l = lot(256),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  const tp = new Float64Array(3),
    tq = new Float64Array(4),
    ts = new Float64Array(3);
  const vp = f64(vueProjection.elements);
  return [
    seule(
      'produit 4×4',
      (i) => l.sortie4[i].multiplyMatrices(vueProjection, l.three[i]),
      (i) => multiplyMatrix4(l.tampons4[i], vp, l.socle[i]),
    ),
    seule(
      'inverse 4×4',
      (i) => l.sortie4[i].copy(l.three[i]).invert(),
      (i) => invertMatrix4(l.tampons4[i], l.socle[i]),
    ),
    seule(
      'déterminant 4×4',
      (i) => l.three[i].determinant(),
      (i) => determinantMatrix4(l.socle[i]),
    ),
    seule(
      'matrice normale',
      (i) => l.sortie3[i].getNormalMatrix(l.three[i]),
      (i) => normalMatrix3(l.tampons3[i], l.socle[i]),
    ),
    seule(
      'composition TRS',
      (i) => l.sortie4[i].compose(l.trs[i].p, l.trs[i].q, l.trs[i].s),
      (i) => composeMatrix4(l.tampons4[i], l.trs[i].pa, l.trs[i].qa, l.trs[i].sa),
    ),
    seule(
      'décomposition TRS',
      (i) => l.three[i].decompose(p, q, s),
      (i) => decomposeMatrix4(l.socle[i], tp, tq, ts),
    ),
    seule(
      'point affine',
      (i) => l.vecteurs[i].fromArray(l.points[i]).applyMatrix4(l.three[i]),
      (i) => transformAffinePoint(tp, l.socle[i], l.points[i][0], l.points[i][1], l.points[i][2]),
    ),
  ];
}

/** Les cinq travaux par lot, sur `n` éléments, en un passage chacun. */
function lignesLot(n) {
  const l = lot(n),
    vp = f64(vueProjection.elements),
    charge = `lot de ${n}`,
    tp = new Float64Array(3);
  const ligne = (nom, three, socle) => mesure({ ligne: nom, charge, operations: n, three, socle });
  return [
    ligne(
      'matrices monde d’une hiérarchie (une Float64Array par élément)',
      () => {
        for (let i = 1; i < n; i++)
          l.sortie4[i].multiplyMatrices(l.sortie4[l.parents[i]], l.three[i]);
      },
      () => {
        for (let i = 1; i < n; i++)
          multiplyMatrix4(l.tampons4[i], l.tampons4[l.parents[i]], l.socle[i]);
      },
    ),
    ligne(
      // Le rangement réel du moteur : un tampon plat et des sous-vues (`tree.world` + `worldViews`,
      // `mathTransformTree.ts`), à côté de la ligne « une Float64Array par élément » ci-dessus.
      'matrices monde d’une hiérarchie (tampon plat, sous-vues)',
      () => {
        for (let i = 1; i < n; i++)
          l.sortie4[i].multiplyMatrices(l.sortie4[l.parents[i]], l.three[i]);
      },
      () => {
        for (let i = 1; i < n; i++)
          multiplyMatrix4(l.tamponsVues[i], l.tamponsVues[l.parents[i]], l.socleVues[i]);
      },
    ),
    ligne(
      'produits vue-projection',
      () => {
        for (let i = 0; i < n; i++) l.sortie4[i].multiplyMatrices(vueProjection, l.three[i]);
      },
      () => {
        for (let i = 0; i < n; i++) multiplyMatrix4(l.tampons4[i], vp, l.socle[i]);
      },
    ),
    ligne(
      'inverses',
      () => {
        for (let i = 0; i < n; i++) l.sortie4[i].copy(l.three[i]).invert();
      },
      () => {
        for (let i = 0; i < n; i++) invertMatrix4(l.tampons4[i], l.socle[i]);
      },
    ),
    ligne(
      'matrices normales',
      () => {
        for (let i = 0; i < n; i++) l.sortie3[i].getNormalMatrix(l.three[i]);
      },
      () => {
        for (let i = 0; i < n; i++) normalMatrix3(l.tampons3[i], l.socle[i]);
      },
    ),
    ligne(
      'transformation de points',
      () => {
        for (let i = 0; i < n; i++) l.vecteurs[i].fromArray(l.points[i]).applyMatrix4(l.three[0]);
      },
      () => {
        for (let i = 0; i < n; i++)
          transformAffinePoint(tp, l.socle[0], l.points[i][0], l.points[i][1], l.points[i][2]);
      },
    ),
  ];
}

/** Une chaîne parent/enfant complète, mise à jour d'un bout à l'autre des deux côtés. */
function ligneChaine(noeuds) {
  const h = hierarchie(noeuds, 0xc4a1);
  return mesure({
    ligne: 'chaîne parent/enfant mise à jour',
    charge: `${h.noeuds.length} nœuds`,
    operations: h.noeuds.length,
    three: () => h.racine.updateMatrixWorld(true),
    socle: () => h.metAJourSocle(),
  });
}

export function lignesPerformance() {
  return [
    ...lignesSeules(),
    ...[1_000, 10_000, 100_000].flatMap(lignesLot),
    ligneChaine(1_000),
    ligneChaine(10_000),
  ];
}
