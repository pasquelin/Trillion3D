// Three.js vs sdk-core, vector and box batches: n elements per call, zero allocation.
// Tested against Three's for loop on 200 000 elements, bit for bit.
import * as THREE from 'three';
import {
  SPHERE_VALUES,
  boxUnionBatch,
  frustumKeepsBoxBatch,
  sphereFromBoundsBatch,
  transformDirectionsBatch,
  transformPointsBatch,
} from '../mathIndex.ts';
import { rapport } from './socle.mjs';
import { duel } from './oracles/three-duel.mjs';
import { N, prepareBatchData } from './oracles/batch-duel.mjs';

const BATCH = 'packages/sdk-core/mathBatch.ts';
const {
  mats,
  pts,
  outPts,
  outThreePts,
  oraclePts,
  boxes,
  threeBoxes,
  threeFrustum,
  planes,
  outExThree,
  outExCore,
} = prepareBatchData();
const lines = [];
// 4. Vector3.applyMatrix4 batch
lines.push(
  await duel({
    name: 'Vector3.applyMatrix4 batch',
    fichier: BATCH,
    three: () => {
      for (let i = 0; i < N; i++) outThreePts[i].copy(pts.three[i]).applyMatrix4(mats.three[0]);
    },
    oracle: oraclePts,
    core: () => {
      transformPointsBatch(outPts, mats.views[0], pts.flat, N);
      return outPts;
    },
  }),
);

// 5. Vector3.transformDirection batch
lines.push(
  await duel({
    name: 'Vector3.transformDirection batch',
    fichier: BATCH,
    three: () => {
      for (let i = 0; i < N; i++)
        outThreePts[i].copy(pts.three[i]).transformDirection(mats.three[0]);
    },
    oracle: oraclePts,
    core: () => {
      transformDirectionsBatch(outPts, mats.views[0], pts.flat, N);
      return outPts;
    },
  }),
);

// 6. Box3.union batch
const threeUnion = new THREE.Box3(),
  threeUnionFlat = new Float64Array(6),
  coreUnion = new Float64Array(6);
lines.push(
  await duel({
    name: 'Box3.union batch',
    fichier: BATCH,
    three: () => {
      threeUnion.makeEmpty();
      for (let i = 0; i < N; i++) threeUnion.union(threeBoxes[i]);
    },
    oracle: () => {
      threeUnionFlat[0] = threeUnion.min.x;
      threeUnionFlat[1] = threeUnion.min.y;
      threeUnionFlat[2] = threeUnion.min.z;
      threeUnionFlat[3] = threeUnion.max.x;
      threeUnionFlat[4] = threeUnion.max.y;
      threeUnionFlat[5] = threeUnion.max.z;
      return threeUnionFlat;
    },
    core: () => {
      coreUnion[0] = coreUnion[1] = coreUnion[2] = Infinity;
      coreUnion[3] = coreUnion[4] = coreUnion[5] = -Infinity;
      boxUnionBatch(coreUnion, boxes, N);
      return coreUnion;
    },
  }),
);

// 7. Box3.getBoundingSphere batch
const outSpheres = new Float64Array(N * SPHERE_VALUES),
  outThreeSpheres = new Float64Array(N * SPHERE_VALUES);
const threeSpheres = Array.from({ length: N }, () => new THREE.Sphere());
lines.push(
  await duel({
    name: 'Box3.getBoundingSphere batch',
    fichier: BATCH,
    three: () => {
      for (let i = 0; i < N; i++) threeBoxes[i].getBoundingSphere(threeSpheres[i]);
    },
    oracle: () => {
      for (let i = 0; i < N; i++) {
        const sphere = threeSpheres[i],
          at = i * SPHERE_VALUES;
        sphere.center.toArray(outThreeSpheres, at);
        outThreeSpheres[at + 3] = sphere.radius;
      }
      return outThreeSpheres;
    },
    core: () => {
      sphereFromBoundsBatch(outSpheres, boxes, N);
      return outSpheres;
    },
  }),
);

// 9. Frustum.intersectsBox batch
lines.push(
  await duel({
    name: 'Frustum.intersectsBox batch',
    fichier: BATCH,
    three: () => {
      for (let i = 0; i < N; i++) outExThree[i] = threeFrustum.intersectsBox(threeBoxes[i]) ? 1 : 0;
    },
    oracle: () => outExThree,
    core: () => {
      frustumKeepsBoxBatch(outExCore, planes, boxes, N);
      return outExCore;
    },
  }),
);

rapport(
  'three-vs-core-batch-volumes',
  lines,
  'sdk-core vector and box batches give the same bits as Three.js, at least as fast',
);
