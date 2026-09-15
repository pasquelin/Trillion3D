// Lot M2, mathBox.ts : boîte vide et inversée, union, extension, transformation par matrice — chaque
// fonction confrontée à l'arithmétique équivalente de Three.js Box3, au bit près (Object.is).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from './index.ts';
import { aPlat, assertBits, boite3 } from './bench/oracles/volumes.mjs';

test('boxEmpty pose des bornes inversées à l’infini, comme Box3.makeEmpty', () => {
  const out = new Float64Array(6);
  boxEmpty(out, 0);
  assertBits(out, aPlat(new THREE.Box3().makeEmpty()));
});

test('boxIsEmpty signale une boîte inversée, pas une boîte ponctuelle ni une borne NaN', () => {
  assert.equal(boxIsEmpty([1, 1, 1, 0, 0, 0], 0), true); // inversée
  assert.equal(boxIsEmpty([2, 3, 4, 2, 3, 4], 0), false); // ponctuelle : bornes égales
  assert.equal(boxIsEmpty([NaN, 0, 0, 1, 1, 1], 0), false); // une borne NaN ne vide pas la boîte
  assert.equal(boxIsEmpty([0, 0, 0, 1, NaN, 1], 0), false);
});

test('boxUnion s’accorde avec Box3.union, boîte vide, zéro signé et infinis compris', () => {
  const cas: [number[], number[]][] = [
    [
      [-1, -1, -1, 1, 1, 1],
      [2, 2, 2, 3, 3, 3],
    ],
    [
      [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
      [0, 0, 0, 1, 1, 1],
    ],
    [
      [-0, -0, -0, 0, 0, 0],
      [0, 0, 0, -0, -0, -0],
    ],
    [
      [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
      [1, 2, 3, 4, 5, 6],
    ],
  ];
  for (const [a, b] of cas) {
    const attendu = aPlat(boite3(a).union(boite3(b)));
    const obtenu = Float64Array.from(a);
    boxUnion(obtenu, 0, b[0], b[1], b[2], b[3], b[4], b[5]);
    assertBits(obtenu, attendu);
  }
});

test('boxExpandByPoint s’accorde avec Box3.expandByPoint, points NaN et infinis compris', () => {
  const cas: [number[], number[]][] = [
    [
      [-1, -1, -1, 1, 1, 1],
      [5, -5, 0],
    ],
    [
      [0, 0, 0, 0, 0, 0],
      [Infinity, -Infinity, NaN],
    ],
    [
      [1, 1, 1, 0, 0, 0],
      [0.5, 0.5, 0.5],
    ], // boîte inversée en entrée
  ];
  for (const [a, p] of cas) {
    const attendu = aPlat(boite3(a).expandByPoint(new THREE.Vector3(p[0], p[1], p[2])));
    const obtenu = Float64Array.from(a);
    boxExpandByPoint(obtenu, 0, p[0], p[1], p[2]);
    assertBits(obtenu, attendu);
  }
});

test('boxTransform s’accorde avec Box3.applyMatrix4 sous échelle négative sur un seul axe', () => {
  const m = new THREE.Matrix4().makeScale(-2, 1, 1).setPosition(3, -1, 2);
  const b = [-1, -2, -3, 4, 5, 6];
  const attendu = aPlat(boite3(b).applyMatrix4(m));
  const obtenu = new Float64Array(6);
  boxTransform(obtenu, 0, b, 0, m.elements);
  assertBits(obtenu, attendu);
});

test('boxTransform s’accorde avec Box3.applyMatrix4 sous échelle non uniforme et rotation parente', () => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.1, 2.3));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 2, -3),
    q,
    new THREE.Vector3(0.2, 5, -1.5),
  );
  const b = [-2, -1, -4, 3, 2, 1];
  const attendu = aPlat(boite3(b).applyMatrix4(m));
  const obtenu = new Float64Array(6);
  boxTransform(obtenu, 0, b, 0, m.elements);
  assertBits(obtenu, attendu);
});

test('boxTransform s’accorde avec Box3.applyMatrix4 sous échelle nulle sur un axe', () => {
  const m = new THREE.Matrix4().makeScale(1, 0, 1);
  const b = [-1, -1, -1, 1, 1, 1];
  const attendu = aPlat(boite3(b).applyMatrix4(m));
  const obtenu = new Float64Array(6);
  boxTransform(obtenu, 0, b, 0, m.elements);
  assertBits(obtenu, attendu);
});

test('boxTransform s’accorde avec Box3.applyMatrix4 sous une matrice NaN, infinie ou nulle', () => {
  const cas = [new Array(16).fill(NaN), new Array(16).fill(Infinity), new Array(16).fill(0)];
  const b = [-1, -1, -1, 1, 1, 1];
  for (const m of cas) {
    const attendu = aPlat(boite3(b).applyMatrix4(new THREE.Matrix4().fromArray(m)));
    const obtenu = new Float64Array(6);
    boxTransform(obtenu, 0, b, 0, m);
    assertBits(obtenu, attendu);
  }
});

test('boxTransform écrit en place (out === box) rend le même résultat qu’une sortie neuve', () => {
  const m = new THREE.Matrix4().makeScale(2, -3, 0.5).setPosition(1, 1, 1);
  const b = [-1, -2, -3, 4, 5, 6];
  const frais = new Float64Array(6);
  boxTransform(frais, 0, b, 0, m.elements);
  const surPlace = Float64Array.from(b);
  boxTransform(surPlace, 0, surPlace, 0, m.elements);
  assertBits(surPlace, frais);
});

test('boxTransform garde une boîte vide inchangée, bornes comprises', () => {
  const vide = new Float64Array(6);
  boxEmpty(vide, 0);
  const avant = Float64Array.from(vide);
  boxTransform(vide, 0, vide, 0, new THREE.Matrix4().makeScale(2, 2, 2).elements);
  assertBits(vide, avant);
});

test('boxCornersInto s’accorde avec Box3 appliquant Matrix4 à chaque coin', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(2, -1, 0.5),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0.2, -1.9)),
    new THREE.Vector3(-1.5, 3, 2),
  );
  const b = [-2, -3, -4, 1, 2, 3];
  const attendu = new Float64Array(24);
  for (let i = 0; i < 8; i++) {
    const coin = new THREE.Vector3(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]);
    coin.applyMatrix4(m).toArray(attendu, i * 3);
  }
  const obtenu = new Float64Array(24);
  boxCornersInto(obtenu, 0, b[0], b[1], b[2], b[3], b[4], b[5], m.elements);
  assertBits(obtenu, attendu);
});
