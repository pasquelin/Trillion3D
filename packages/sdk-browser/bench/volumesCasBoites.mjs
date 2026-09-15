// Cas d'équivalence du lot M2, boîtes et sphères : chaque fonction de `sdk-core` contre la méthode
// de Three.js qu'elle remplace, sur les entrées hostiles de `scenesVolumes.mjs`. Aucun gain cherché :
// seule la colonne « identique » décide, au bit près (`Object.is` sépare −0 de +0 et voit NaN).
import * as THREE from 'three';
import {
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
  sphereFromBounds,
} from '../../sdk-core/index.ts';
import { boitesHierarchiques } from './scenesHierarchies.mjs';
import { boites, matrices } from './scenesVolumes.mjs';
import { aPlat, boite3 } from '../../sdk-core/bench/oracles/volumes.mjs';

const un = (nom, entree) => [{ nom, entree, taille: entree.length }];
/** Les cas hostiles, puis les matrices monde de vraies hiérarchies Three.js. */
const etHierarchies = (nom, entree) => [
  ...un(nom, entree),
  ...un('boîtes × matrices monde hiérarchiques', boitesHierarchiques),
];
const paires = boites.flatMap((a, i) =>
  boites.filter((_, j) => j % 13 === i % 13).map((b) => [a, b]),
);
const transformations = boites.flatMap((b, i) =>
  matrices.filter((_, j) => j % 5 === i % 5).map((m) => [b, m]),
);

/** Les lignes d'équivalence des boîtes et sphères, sans options de chronomètre. */
export const casBoites = [
  {
    calcul: 'boîte vide et test de vide',
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: un('boîtes hostiles', boites),
    reference: (liste) => [
      aPlat(new THREE.Box3().makeEmpty()),
      liste.map((b) => boite3(b).isEmpty()),
    ],
    optimisee: (liste) => {
      const vide = new Float64Array(6);
      boxEmpty(vide, 0);
      return [vide, liste.map((b) => boxIsEmpty(b, 0))];
    },
  },
  {
    calcul: 'union de deux boîtes',
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: un('paires de boîtes hostiles', paires),
    reference: (liste) => liste.map(([a, b]) => aPlat(boite3(a).union(boite3(b)))),
    optimisee: (liste) =>
      liste.map(([a, b]) => {
        const sortie = Float64Array.from(a);
        boxUnion(sortie, 0, b[0], b[1], b[2], b[3], b[4], b[5]);
        return sortie;
      }),
  },
  {
    calcul: "extension d'une boîte par deux points",
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: un('paires de boîtes hostiles', paires),
    reference: (liste) =>
      liste.map(([a, b]) => {
        const box = boite3(a);
        box.expandByPoint(new THREE.Vector3(b[0], b[1], b[2]));
        return aPlat(box.expandByPoint(new THREE.Vector3(b[3], b[4], b[5])));
      }),
    optimisee: (liste) =>
      liste.map(([a, b]) => {
        const sortie = Float64Array.from(a);
        boxExpandByPoint(sortie, 0, b[0], b[1], b[2]);
        boxExpandByPoint(sortie, 0, b[3], b[4], b[5]);
        return sortie;
      }),
  },
  {
    calcul: "transformation d'une boîte par une matrice",
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: etHierarchies('boîtes × matrices hostiles', transformations),
    reference: (liste) =>
      liste.map(([b, m]) => aPlat(boite3(b).applyMatrix4(new THREE.Matrix4().fromArray(m)))),
    optimisee: (liste) =>
      liste.map(([b, m]) => {
        const sortie = new Float64Array(6),
          surPlace = Float64Array.from(b);
        boxTransform(sortie, 0, b, 0, m);
        boxTransform(surPlace, 0, surPlace, 0, m);
        for (let i = 0; i < 6; i++)
          if (!Object.is(sortie[i], surPlace[i])) throw new Error('BOX_TRANSFORM_ALIAS');
        return sortie;
      }),
  },
  {
    calcul: "huit coins transformés d'une boîte",
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: etHierarchies('boîtes × matrices hostiles', transformations),
    reference: (liste) =>
      liste.map(([b, m]) => {
        const matrice = new THREE.Matrix4().fromArray(m),
          sortie = new Float64Array(24),
          coin = new THREE.Vector3();
        for (let i = 0; i < 8; i++) {
          coin.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]);
          coin.applyMatrix4(matrice).toArray(sortie, i * 3);
        }
        return sortie;
      }),
    optimisee: (liste) =>
      liste.map(([b, m]) => {
        const sortie = new Float64Array(24);
        boxCornersInto(sortie, 0, b[0], b[1], b[2], b[3], b[4], b[5], m);
        return sortie;
      }),
  },
  {
    calcul: "sphère englobante d'une boîte transformée",
    fichier: 'packages/sdk-core/mathSphere.ts',
    cas: etHierarchies('boîtes × matrices hostiles', transformations),
    reference: (liste) =>
      liste.map(([b, m]) => {
        const box = boite3(b).applyMatrix4(new THREE.Matrix4().fromArray(m));
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        return Float64Array.of(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
      }),
    optimisee: (liste) =>
      liste.map(([b, m]) => {
        const box = new Float64Array(6),
          sortie = new Float64Array(4);
        boxTransform(box, 0, b, 0, m);
        sphereFromBounds(sortie, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
        return sortie;
      }),
  },
  {
    calcul: "sphère englobante d'une boîte",
    fichier: 'packages/sdk-core/mathSphere.ts',
    cas: un('boîtes hostiles', boites),
    reference: (liste) =>
      liste.map((b) => {
        const sphere = boite3(b).getBoundingSphere(new THREE.Sphere());
        return Float64Array.of(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
      }),
    optimisee: (liste) =>
      liste.map((b) => {
        const sortie = new Float64Array(4);
        sphereFromBounds(sortie, 0, b[0], b[1], b[2], b[3], b[4], b[5]);
        return sortie;
      }),
  },
];
