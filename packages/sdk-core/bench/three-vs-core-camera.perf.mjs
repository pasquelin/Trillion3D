// Three.js vs sdk-core, camera: the perspective projection and the frustum planes of a clip
// matrix. The engine's depth is reversed and its far plane infinite by design (`mathCamera.ts`),
// so the projection compares its x and y terms only, and the frustum its four side planes, the
// ones both conventions share. Both sides store the compared terms in the same loop, four or
// sixteen stores per element. The view and view-projection are the inverse and the product
// measured by the matrices bench.
import * as THREE from 'three';
import { perspectiveProjection } from '../mathCamera.ts';
import { FRUSTUM_PLANE_VALUES, frustumPlanesFromMatrix } from '../mathFrustum.ts';
import { rapport } from './socle.mjs';
import { N, duel, rnd, trsMatrices } from './oracles/three-duel.mjs';

const ASPECT = 1.5,
  NEAR = 0.1,
  FAR = 1000;
const DEG2RAD = Math.PI / 180;
const fov = Float64Array.from({ length: N }, () => rnd(20, 120));
const projectionThree = new THREE.Matrix4();
const projection = new Float64Array(16);
const xy = new Float64Array(N * 4),
  xyThree = new Float64Array(N * 4);

const lines = [];
lines.push(
  await duel({
    name: 'Matrix4.makePerspective',
    fichier: 'packages/sdk-core/mathCamera.ts',
    three: () => {
      for (let i = 0; i < N; i++) {
        // The bounds `PerspectiveCamera.updateProjectionMatrix` derives from its field of view.
        const top = NEAR * Math.tan(DEG2RAD * 0.5 * fov[i]),
          height = 2 * top,
          width = ASPECT * height,
          left = -0.5 * width;
        projectionThree.makePerspective(left, left + width, top, top - height, NEAR, FAR);
        const e = projectionThree.elements;
        xyThree[i * 4] = e[0];
        xyThree[i * 4 + 1] = e[5];
        xyThree[i * 4 + 2] = e[8];
        xyThree[i * 4 + 3] = e[9];
      }
    },
    oracle: () => xyThree,
    core: () => {
      for (let i = 0; i < N; i++) {
        perspectiveProjection(projection, fov[i], ASPECT, NEAR, 1);
        xy[i * 4] = projection[0];
        xy[i * 4 + 1] = projection[5];
        xy[i * 4 + 2] = projection[8];
        xy[i * 4 + 3] = projection[9];
      }
      return xy;
    },
    motif: 'x and y terms only: the engine projects with reversed, infinite depth',
  }),
);

// The frustum: six planes read from a clip matrix, one random view-projection per element.
const clip = trsMatrices(N);
const frustum = new THREE.Frustum();
const planes = new Float64Array(FRUSTUM_PLANE_VALUES);
const sides = new Float64Array(N * 16),
  sidesThree = new Float64Array(N * 16);

lines.push(
  await duel({
    name: 'Frustum.setFromProjectionMatrix',
    fichier: 'packages/sdk-core/mathFrustum.ts',
    three: () => {
      for (let i = 0; i < N; i++) {
        frustum.setFromProjectionMatrix(clip.three[i]);
        for (let p = 0; p < 4; p++) {
          const { normal, constant } = frustum.planes[p];
          const at = i * 16 + p * 4;
          sidesThree[at] = normal.x;
          sidesThree[at + 1] = normal.y;
          sidesThree[at + 2] = normal.z;
          sidesThree[at + 3] = constant;
        }
      }
    },
    oracle: () => sidesThree,
    core: () => {
      for (let i = 0; i < N; i++) {
        frustumPlanesFromMatrix(planes, clip.views[i]);
        for (let k = 0; k < 16; k++) sides[i * 16 + k] = planes[k];
      }
      return sides;
    },
    motif: 'four side planes only: near and far follow each convention',
  }),
);

rapport(
  'three-vs-core-camera',
  lines,
  'sdk-core projection and frustum give the same bits as Three.js, at least as fast',
);
