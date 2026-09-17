// A9 : le sens de parcours d'un cluster est mémorisé sur la page et invalidé seulement quand
// l'époque de la table de lignes change, au lieu d'un déterminant 3×3 recalculé à chaque lecture.
// Oracle : la version sans cache, d'avant le lot A, dans `bench/oracles/pages.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setWindingEpoch, windingCw } from './webgpuPagesWinding.ts';
import { referenceWindingCw } from './bench/oracles/pages-webgpu.mjs';
import type { PageRec } from './pageSelectionTypes.ts';

function rec(matrix: THREE.Matrix4): PageRec {
  return { matrix } as PageRec;
}

test('the identity matrix and a mirrored (negative-scale) matrix agree with the reference', () => {
  setWindingEpoch(1);
  const identity = rec(new THREE.Matrix4());
  const mirrored = rec(new THREE.Matrix4().makeScale(1, 1, -1));
  assert.equal(windingCw(identity), referenceWindingCw(identity));
  assert.equal(windingCw(mirrored), referenceWindingCw(mirrored));
  assert.notEqual(windingCw(identity), windingCw(mirrored));
});

test('a cached value from an old epoch is recomputed, and a same-epoch read reuses it verbatim', () => {
  setWindingEpoch(5);
  const page = rec(new THREE.Matrix4().makeRotationY(0.7));
  const first = windingCw(page);
  assert.equal(page.windingEpoch, 5);
  // Same epoch, matrix mutated without going through the cache: the cached (stale) value still
  // comes back, exactly the point of memoising it on the record.
  page.matrix.makeScale(1, 1, -1);
  assert.equal(windingCw(page), first, 'same epoch: the memoised value is reused, not recomputed');
  setWindingEpoch(6);
  assert.equal(
    windingCw(page),
    referenceWindingCw(page),
    'new epoch: recomputed from the current matrix',
  );
});

test('a degenerate (all-zero) matrix never throws and matches the reference verdict', () => {
  setWindingEpoch(9);
  const zero = rec(new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
  assert.equal(windingCw(zero), referenceWindingCw(zero));
});
