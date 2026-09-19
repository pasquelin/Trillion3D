// Three.js vs sdk-core, matrices: product, inverse, composition and decomposition of a
// translation-rotation-scale. Same seeded matrices on both sides; each side writes its own
// output in its own form, Three's read flat untimed as the oracle.
import * as THREE from 'three';
import { multiplyMatrix4 } from '../mathMatrix4.ts';
import { invertMatrix4 } from '../mathMatrix4Inverse.ts';
import { composeMatrix4, decomposeMatrix4 } from '../mathMatrix4Trs.ts';
import { rapport } from './socle.mjs';
import { N, duel, flatOf, points, quaternion, trsMatrices, views } from './oracles/three-duel.mjs';

const TRS = 'packages/sdk-core/mathMatrix4Trs.ts';
const a = trsMatrices(N),
  b = trsMatrices(N);
const outThree = Array.from({ length: N }, () => new THREE.Matrix4());
const outFlatThree = new Float64Array(N * 16);
const oracle = () => flatOf(outThree, 16, outFlatThree);
const out = new Float64Array(N * 16),
  outViews = views(out, 16);

const lines = [];
lines.push(
  await duel({
    name: 'Matrix4.multiplyMatrices',
    fichier: 'packages/sdk-core/mathMatrix4.ts',
    three: () => {
      for (let i = 0; i < N; i++) outThree[i].multiplyMatrices(a.three[i], b.three[i]);
    },
    oracle,
    core: () => {
      for (let i = 0; i < N; i++) multiplyMatrix4(outViews[i], a.views[i], b.views[i]);
      return out;
    },
  }),
);

lines.push(
  await duel({
    name: 'Matrix4.invert',
    fichier: 'packages/sdk-core/mathMatrix4Inverse.ts',
    three: () => {
      for (let i = 0; i < N; i++) outThree[i].copy(a.three[i]).invert();
    },
    oracle,
    core: () => {
      for (let i = 0; i < N; i++) invertMatrix4(outViews[i], a.views[i]);
      return out;
    },
  }),
);

// Composition: positions, quaternions and scales drawn once, flat on the engine's side.
const position = points(N),
  scale = points(N, 0.2, 3);
const rotation = [],
  q = new Float64Array(N * 4);
for (let i = 0; i < N; i++) {
  rotation.push(quaternion());
  q[i * 4] = rotation[i].x;
  q[i * 4 + 1] = rotation[i].y;
  q[i * 4 + 2] = rotation[i].z;
  q[i * 4 + 3] = rotation[i].w;
}
const pViews = views(position.flat, 3),
  qViews = views(q, 4),
  sViews = views(scale.flat, 3);

lines.push(
  await duel({
    name: 'Matrix4.compose',
    fichier: TRS,
    three: () => {
      for (let i = 0; i < N; i++)
        outThree[i].compose(position.three[i], rotation[i], scale.three[i]);
    },
    oracle,
    core: () => {
      for (let i = 0; i < N; i++) composeMatrix4(outViews[i], pViews[i], qViews[i], sViews[i]);
      return out;
    },
  }),
);

// Decomposition: ten numbers per matrix (position, quaternion, scale), written by both sides
// from their scratch vectors in the same ten stores.
const decomposed = new Float64Array(N * 10),
  decomposedThree = new Float64Array(N * 10);
const dp = new THREE.Vector3(),
  dq = new THREE.Quaternion(),
  ds = new THREE.Vector3();
const ep = new Float64Array(3),
  eq = new Float64Array(4),
  es = new Float64Array(3);

lines.push(
  await duel({
    name: 'Matrix4.decompose',
    fichier: TRS,
    three: () => {
      for (let i = 0; i < N; i++) {
        a.three[i].decompose(dp, dq, ds);
        const at = i * 10;
        decomposedThree[at] = dp.x;
        decomposedThree[at + 1] = dp.y;
        decomposedThree[at + 2] = dp.z;
        decomposedThree[at + 3] = dq.x;
        decomposedThree[at + 4] = dq.y;
        decomposedThree[at + 5] = dq.z;
        decomposedThree[at + 6] = dq.w;
        decomposedThree[at + 7] = ds.x;
        decomposedThree[at + 8] = ds.y;
        decomposedThree[at + 9] = ds.z;
      }
    },
    oracle: () => decomposedThree,
    core: () => {
      for (let i = 0; i < N; i++) {
        decomposeMatrix4(a.views[i], ep, eq, es);
        const at = i * 10;
        decomposed[at] = ep[0];
        decomposed[at + 1] = ep[1];
        decomposed[at + 2] = ep[2];
        decomposed[at + 3] = eq[0];
        decomposed[at + 4] = eq[1];
        decomposed[at + 5] = eq[2];
        decomposed[at + 6] = eq[3];
        decomposed[at + 7] = es[0];
        decomposed[at + 8] = es[1];
        decomposed[at + 9] = es[2];
      }
      return decomposed;
    },
  }),
);

rapport(
  'three-vs-core-matrices',
  lines,
  'sdk-core matrices give the same bits as Three.js, at least as fast',
);
