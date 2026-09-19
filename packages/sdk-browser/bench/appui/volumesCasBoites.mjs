// Equivalence cases of batch M2, boxes and spheres: each `sdk-core` function against the
// Three.js method it replaces, on the hostile inputs of `scenesVolumes.mjs`. No gain sought:
// only the "identical" column decides, bit-exact (`Object.is` separates −0 from +0 and sees NaN).
import * as THREE from 'three';
import {
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
  sphereFromBounds,
} from '../../../sdk-core/index.ts';
import { boitesHierarchiques } from './scenesHierarchies.mjs';
import { boites, matrices } from './scenesVolumes.mjs';
import { aPlat, boite3 } from '../../../sdk-core/bench/oracles/volumes.mjs';

const un = (name, input) => [{ name, input, size: input.length }];
/** Hostile cases, then the world matrices of real Three.js hierarchies. */
const etHierarchies = (name, input) => [
  ...un(name, input),
  ...un('boxes × hierarchical world matrices', boitesHierarchiques),
];
const paires = boites.flatMap((a, i) =>
  boites.filter((_, j) => j % 13 === i % 13).map((b) => [a, b]),
);
const transformations = boites.flatMap((b, i) =>
  matrices.filter((_, j) => j % 5 === i % 5).map((m) => [b, m]),
);

/** Equivalence lines of boxes and spheres, without timer options. */
export const casBoites = [
  {
    calcul: 'empty box and emptiness test',
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: un('hostile boxes', boites),
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
    calcul: 'union of two boxes',
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: un('hostile box pairs', paires),
    reference: (liste) => liste.map(([a, b]) => aPlat(boite3(a).union(boite3(b)))),
    optimisee: (liste) =>
      liste.map(([a, b]) => {
        const output = Float64Array.from(a);
        boxUnion(output, 0, b[0], b[1], b[2], b[3], b[4], b[5]);
        return output;
      }),
  },
  {
    calcul: 'extension of a box by two points',
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: un('hostile box pairs', paires),
    reference: (liste) =>
      liste.map(([a, b]) => {
        const box = boite3(a);
        box.expandByPoint(new THREE.Vector3(b[0], b[1], b[2]));
        return aPlat(box.expandByPoint(new THREE.Vector3(b[3], b[4], b[5])));
      }),
    optimisee: (liste) =>
      liste.map(([a, b]) => {
        const output = Float64Array.from(a);
        boxExpandByPoint(output, 0, b[0], b[1], b[2]);
        boxExpandByPoint(output, 0, b[3], b[4], b[5]);
        return output;
      }),
  },
  {
    calcul: 'transform of a box by a matrix',
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: etHierarchies('boxes × hostile matrices', transformations),
    reference: (liste) =>
      liste.map(([b, m]) => aPlat(boite3(b).applyMatrix4(new THREE.Matrix4().fromArray(m)))),
    optimisee: (liste) =>
      liste.map(([b, m]) => {
        const output = new Float64Array(6),
          surPlace = Float64Array.from(b);
        boxTransform(output, 0, b, 0, m);
        boxTransform(surPlace, 0, surPlace, 0, m);
        for (let i = 0; i < 6; i++)
          if (!Object.is(output[i], surPlace[i])) throw new Error('BOX_TRANSFORM_ALIAS');
        return output;
      }),
  },
  {
    calcul: 'eight transformed corners of a box',
    fichier: 'packages/sdk-core/mathBox.ts',
    cas: etHierarchies('boxes × hostile matrices', transformations),
    reference: (liste) =>
      liste.map(([b, m]) => {
        const matrice = new THREE.Matrix4().fromArray(m),
          output = new Float64Array(24),
          coin = new THREE.Vector3();
        for (let i = 0; i < 8; i++) {
          coin.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]);
          coin.applyMatrix4(matrice).toArray(output, i * 3);
        }
        return output;
      }),
    optimisee: (liste) =>
      liste.map(([b, m]) => {
        const output = new Float64Array(24);
        boxCornersInto(output, 0, b[0], b[1], b[2], b[3], b[4], b[5], m);
        return output;
      }),
  },
  {
    calcul: 'bounding sphere of a transformed box',
    fichier: 'packages/sdk-core/mathSphere.ts',
    cas: etHierarchies('boxes × hostile matrices', transformations),
    reference: (liste) =>
      liste.map(([b, m]) => {
        const box = boite3(b).applyMatrix4(new THREE.Matrix4().fromArray(m));
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        return Float64Array.of(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
      }),
    optimisee: (liste) =>
      liste.map(([b, m]) => {
        const box = new Float64Array(6),
          output = new Float64Array(4);
        boxTransform(box, 0, b, 0, m);
        sphereFromBounds(output, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
        return output;
      }),
  },
  {
    calcul: 'bounding sphere of a box',
    fichier: 'packages/sdk-core/mathSphere.ts',
    cas: un('hostile boxes', boites),
    reference: (liste) =>
      liste.map((b) => {
        const sphere = boite3(b).getBoundingSphere(new THREE.Sphere());
        return Float64Array.of(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
      }),
    optimisee: (liste) =>
      liste.map((b) => {
        const output = new Float64Array(4);
        sphereFromBounds(output, 0, b[0], b[1], b[2], b[3], b[4], b[5]);
        return output;
      }),
  },
];
