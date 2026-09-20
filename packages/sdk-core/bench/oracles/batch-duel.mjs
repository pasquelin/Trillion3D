import * as THREE from 'three';
import { BOX_VALUES } from '../../mathBox.ts';
import { N, alea, flatOf, points, trsMatrices, views } from './three-duel.mjs';

export { N };

export function prepareBatchData() {
  const mats = trsMatrices(N);
  const outMats = new Float64Array(N * 16);
  const outMatViews = views(outMats, 16);
  const outThreeMats = Array.from({ length: N }, () => new THREE.Matrix4());
  const outFlatThree = new Float64Array(N * 16);
  const oracleMats = () => flatOf(outThreeMats, 16, outFlatThree);

  const pts = points(N);
  const outPts = new Float64Array(N * 3);
  const outThreePts = Array.from({ length: N }, () => new THREE.Vector3());
  const outFlatThreePts = new Float64Array(N * 3);
  const oraclePts = () => flatOf(outThreePts, 3, outFlatThreePts);

  const boxes = new Float64Array(N * BOX_VALUES);
  const threeBoxes = [];
  for (let i = 0; i < N; i++) {
    const at = i * BOX_VALUES;
    const x = alea() * 100,
      y = alea() * 100,
      z = alea() * 100;
    boxes[at] = x;
    boxes[at + 1] = y;
    boxes[at + 2] = z;
    boxes[at + 3] = x + alea() * 10;
    boxes[at + 4] = y + alea() * 10;
    boxes[at + 5] = z + alea() * 10;
    threeBoxes.push(
      new THREE.Box3(
        new THREE.Vector3(boxes[at], boxes[at + 1], boxes[at + 2]),
        new THREE.Vector3(boxes[at + 3], boxes[at + 4], boxes[at + 5]),
      ),
    );
  }

  const threeFrustum = new THREE.Frustum();
  threeFrustum.planes[0].setComponents(1, 0, 0, -10);
  threeFrustum.planes[1].setComponents(-1, 0, 0, 50);
  threeFrustum.planes[2].setComponents(0, 1, 0, -10);
  threeFrustum.planes[3].setComponents(0, -1, 0, 50);
  threeFrustum.planes[4].setComponents(0, 0, 1, -10);
  threeFrustum.planes[5].setComponents(0, 0, -1, 50);
  const planes = new Float64Array(24);
  for (let i = 0; i < 6; i++) {
    const p = threeFrustum.planes[i];
    planes[i * 4] = p.normal.x;
    planes[i * 4 + 1] = p.normal.y;
    planes[i * 4 + 2] = p.normal.z;
    planes[i * 4 + 3] = p.constant;
  }
  // One keep flag per box, the type `frustumKeepsBoxBatch` writes into.
  const outExThree = new Uint8Array(N),
    outExCore = new Uint8Array(N);

  return {
    mats,
    outMats,
    outMatViews,
    outThreeMats,
    oracleMats,
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
  };
}
