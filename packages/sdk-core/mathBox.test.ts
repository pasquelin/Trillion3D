// Batch M2, mathBox.ts: empty and inverted box, union, expansion, matrix transformation — each
// function tested against equivalent Three.js Box3 arithmetic, bitwise (Object.is).
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

test('boxEmpty sets inverted bounds at infinity, like Box3.makeEmpty', () => {
  const out = new Float64Array(6);
  boxEmpty(out, 0);
  assertBits(out, aPlat(new THREE.Box3().makeEmpty()));
});

test('boxIsEmpty reports an inverted box, not a point box nor a NaN bound', () => {
  assert.equal(boxIsEmpty([1, 1, 1, 0, 0, 0], 0), true); // inverted
  assert.equal(boxIsEmpty([2, 3, 4, 2, 3, 4], 0), false); // point: equal bounds
  assert.equal(boxIsEmpty([NaN, 0, 0, 1, 1, 1], 0), false); // a NaN bound does not empty the box
  assert.equal(boxIsEmpty([0, 0, 0, 1, NaN, 1], 0), false);
});

test('boxUnion matches Box3.union, including empty box, signed zero, and infinities', () => {
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

test('boxExpandByPoint matches Box3.expandByPoint, including NaN and infinite points', () => {
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
    ], // input inverted box
  ];
  for (const [a, p] of cas) {
    const attendu = aPlat(boite3(a).expandByPoint(new THREE.Vector3(p[0], p[1], p[2])));
    const obtenu = Float64Array.from(a);
    boxExpandByPoint(obtenu, 0, p[0], p[1], p[2]);
    assertBits(obtenu, attendu);
  }
});

test('boxTransform matches Box3.applyMatrix4 under negative scale on a single axis', () => {
  const m = new THREE.Matrix4().makeScale(-2, 1, 1).setPosition(3, -1, 2);
  const b = [-1, -2, -3, 4, 5, 6];
  const attendu = aPlat(boite3(b).applyMatrix4(m));
  const obtenu = new Float64Array(6);
  boxTransform(obtenu, 0, b, 0, m.elements);
  assertBits(obtenu, attendu);
});

test('boxTransform matches Box3.applyMatrix4 under non-uniform scale and parent rotation', () => {
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

test('boxTransform matches Box3.applyMatrix4 under zero scale on an axis', () => {
  const m = new THREE.Matrix4().makeScale(1, 0, 1);
  const b = [-1, -1, -1, 1, 1, 1];
  const attendu = aPlat(boite3(b).applyMatrix4(m));
  const obtenu = new Float64Array(6);
  boxTransform(obtenu, 0, b, 0, m.elements);
  assertBits(obtenu, attendu);
});

test('boxTransform matches Box3.applyMatrix4 under NaN, infinite, or zero matrix', () => {
  const cas = [new Array(16).fill(NaN), new Array(16).fill(Infinity), new Array(16).fill(0)];
  const b = [-1, -1, -1, 1, 1, 1];
  for (const m of cas) {
    const attendu = aPlat(boite3(b).applyMatrix4(new THREE.Matrix4().fromArray(m)));
    const obtenu = new Float64Array(6);
    boxTransform(obtenu, 0, b, 0, m);
    assertBits(obtenu, attendu);
  }
});

test('boxTransform in place (out === box) yields same result as a fresh output', () => {
  const m = new THREE.Matrix4().makeScale(2, -3, 0.5).setPosition(1, 1, 1);
  const b = [-1, -2, -3, 4, 5, 6];
  const frais = new Float64Array(6);
  boxTransform(frais, 0, b, 0, m.elements);
  const surPlace = Float64Array.from(b);
  boxTransform(surPlace, 0, surPlace, 0, m.elements);
  assertBits(surPlace, frais);
});

test('boxTransform keeps an empty box unchanged, bounds included', () => {
  const vide = new Float64Array(6);
  boxEmpty(vide, 0);
  const before = Float64Array.from(vide);
  boxTransform(vide, 0, vide, 0, new THREE.Matrix4().makeScale(2, 2, 2).elements);
  assertBits(vide, before);
});

test('boxCornersInto matches Box3 applying Matrix4 to each corner', () => {
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
