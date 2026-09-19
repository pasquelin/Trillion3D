// Three.js vs sdk-core, matrix batches: n matrices per call, flat buffers, zero allocation.
// Tested against Three's for loop on 200 000 elements, bit for bit.
import * as THREE from 'three';
import { composeMatrix4Batch, invertMatrix4Batch, normalMatrix3Batch } from '../mathIndex.ts';
import { rapport } from './socle.mjs';
import { duel, points, quaternion } from './oracles/three-duel.mjs';
import { N, prepareBatchData } from './oracles/batch-duel.mjs';

const BATCH = 'packages/sdk-core/mathBatch.ts';
const { mats, outMats, outMatViews, outThreeMats, oracleMats } = prepareBatchData();
const lines = [];

// 1. Matrix4.invert batch
lines.push(
  await duel({
    name: 'Matrix4.invert batch',
    fichier: BATCH,
    // Not the same computation: Three's `invert()` leaves a singular matrix as sixteen silent
    // zeros, the batch reads the determinant to name it in `singular` and write the identity.
    slower: {
      atMost: 1.2,
      reason: 'reads the determinant to report the singular case Three leaves silent',
    },
    three: () => {
      for (let i = 0; i < N; i++) outThreeMats[i].copy(mats.three[i]).invert();
    },
    oracle: oracleMats,
    core: () => {
      invertMatrix4Batch(outMatViews, mats.views, N);
      return outMats;
    },
  }),
);

// 2. Matrix4.compose batch
const pos = points(N),
  scale = points(N, 0.2, 3),
  rotFlat = new Float64Array(N * 4);
const rot = Array.from({ length: N }, (_, i) => {
  const q = quaternion();
  rotFlat[i * 4] = q.x;
  rotFlat[i * 4 + 1] = q.y;
  rotFlat[i * 4 + 2] = q.z;
  rotFlat[i * 4 + 3] = q.w;
  return q;
});
lines.push(
  await duel({
    name: 'Matrix4.compose batch',
    fichier: BATCH,
    three: () => {
      for (let i = 0; i < N; i++) outThreeMats[i].compose(pos.three[i], rot[i], scale.three[i]);
    },
    oracle: oracleMats,
    core: () => {
      composeMatrix4Batch(outMats, pos.flat, rotFlat, scale.flat, N);
      return outMats;
    },
  }),
);

// 3. NormalMatrix3 batch
const outNormals = new Float64Array(N * 9),
  outThreeNormals = new Float64Array(N * 9);
// One Matrix3 per element, like the other lines keep one Three object per element: reading the
// nine floats out of them belongs to the oracle, not to the chronometer, or Three would be timed
// on a flatten the engine never does and the ratio would flatter the engine.
const threeNormals = Array.from({ length: N }, () => new THREE.Matrix3());
lines.push(
  await duel({
    name: 'NormalMatrix3 batch',
    fichier: BATCH,
    // Not the same computation: `normalMatrix3` carries the singularity decision the WGSL kernel
    // mirrors (`mathSingular.ts`, `inverseTransposeWgsl.ts`), which `getNormalMatrix` does not have.
    slower: {
      atMost: 2.2,
      reason: 'carries the singularity decision the WGSL kernel mirrors, which Three has not',
    },
    three: () => {
      for (let i = 0; i < N; i++) threeNormals[i].getNormalMatrix(mats.three[i]);
    },
    oracle: () => {
      for (let i = 0; i < N; i++) {
        const e = threeNormals[i].elements,
          at = i * 9;
        for (let k = 0; k < 9; k++) outThreeNormals[at + k] = e[k];
      }
      return outThreeNormals;
    },
    core: () => {
      normalMatrix3Batch(outNormals, mats.views, N);
      return outNormals;
    },
  }),
);

rapport(
  'three-vs-core-batch-matrices',
  lines,
  'sdk-core matrix batches give the same bits as Three.js, at least as fast where they compute the same thing',
);
