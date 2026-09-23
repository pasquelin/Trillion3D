// Per-instance batches: identical seeded inputs; flattening belongs to the untimed oracle.
import * as THREE from 'three';
import {
  boxEmpty,
  boxTransformUnionBatch,
  decomposeMatrix4Batch,
  transformPointsByMatricesBatch,
} from '../../../packages/sdk-core/src/math/index.ts';
import { rapport } from '../../core/index.ts';
import type { Mesure } from '../../core/index.ts';
import { duel } from '../../oracles/core/three-duel.ts';
import { N, prepareBatchData } from '../../oracles/core/batch-duel.ts';

const { mats, pts, outPts, outThreePts, oraclePts, boxes, threeBoxes } = prepareBatchData();
const lines: Mesure[] = [];
lines.push(
  await duel({
    name: 'Vector3.applyMatrix4 per-instance batch',
    fichier: 'packages/sdk-core/src/math/batch/points.ts',
    three: () => {
      for (let i = 0; i < N; i++) outThreePts[i].copy(pts.three[i]).applyMatrix4(mats.three[i]);
    },
    oracle: oraclePts,
    core: () => {
      transformPointsByMatricesBatch(outPts, mats.views, pts.flat, N);
      return outPts;
    },
  }),
);

// Position, quaternion, scale: ten numbers per element, every component compared.
const outTrs = new Float64Array(N * 10),
  oracleTrs = new Float64Array(N * 10);
const positions = Array.from({ length: N }, (_, i) => outTrs.subarray(i * 10, i * 10 + 3));
const rotations = Array.from({ length: N }, (_, i) => outTrs.subarray(i * 10 + 3, i * 10 + 7));
const scales = Array.from({ length: N }, (_, i) => outTrs.subarray(i * 10 + 7, i * 10 + 10));
const threePositions = Array.from({ length: N }, () => new THREE.Vector3());
const threeRotations = Array.from({ length: N }, () => new THREE.Quaternion());
const threeScales = Array.from({ length: N }, () => new THREE.Vector3());
lines.push(
  await duel({
    name: 'Matrix4.decompose batch',
    fichier: 'packages/sdk-core/src/math/batch/transforms.ts',
    three: () => {
      for (let i = 0; i < N; i++)
        mats.three[i].decompose(threePositions[i], threeRotations[i], threeScales[i]);
    },
    oracle: () => {
      for (let i = 0; i < N; i++) {
        threePositions[i].toArray(oracleTrs, i * 10);
        threeRotations[i].toArray(oracleTrs, i * 10 + 3);
        threeScales[i].toArray(oracleTrs, i * 10 + 7);
      }
      return oracleTrs;
    },
    core: () => {
      decomposeMatrix4Batch(positions, rotations, scales, mats.views, N);
      return outTrs;
    },
  }),
);

const threeUnion = new THREE.Box3(),
  scratch = new THREE.Box3();
const oracleUnion = new Float64Array(6),
  union = new Float64Array(6);
lines.push(
  await duel({
    name: 'Box3 transform and union batch',
    fichier: 'packages/sdk-core/src/math/batch/batch.ts',
    three: () => {
      threeUnion.makeEmpty();
      for (let i = 0; i < N; i++)
        threeUnion.union(scratch.copy(threeBoxes[i]).applyMatrix4(mats.three[i]));
    },
    oracle: () => {
      threeUnion.min.toArray(oracleUnion, 0);
      threeUnion.max.toArray(oracleUnion, 3);
      return oracleUnion;
    },
    core: () => {
      boxEmpty(union, 0);
      boxTransformUnionBatch(union, boxes, mats.views, N);
      return union;
    },
  }),
);
rapport(
  'three-vs-core-batch-instances',
  lines,
  'Per-instance batches: seeded parity and timed operations',
);
