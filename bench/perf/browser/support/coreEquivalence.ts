// First part of the foundation bench, against the reference: each function opposed to the
// method it replaces, on the hostile inputs, then parent/child hierarchies node by node. A
// single different value in the sense of `Object.is` and the line fails.
import * as THREE from 'three';
import {
  crossVector3,
  decomposeMatrix4,
  determinantMatrix4,
  dotVector3,
  invertMatrix4,
  multiplyMatrix4,
  normalMatrix3,
  transformAffinePoint,
  transformHomogeneousPoint,
} from '../../../../packages/sdk-core/src/index.ts';
import { parElement, type Measurement } from '../../../core/index.ts';
import { chainesHostiles, lectureReference, lectureSocle } from './coreHierarchy.ts';
import { f64, ligne, m4, referenceNormal, trsReference } from './coreLine.ts';
import { affines, matrices, pairs, pairs32, points } from './scenesCore.ts';
import * as S from './coreOutputs.ts';

const v3 = (p: ArrayLike<number>) => new THREE.Vector3(p[0], p[1], p[2]);
/** Each matrix against each sample point. */
const crossed = <T>(list: ArrayLike<number>[], fn: (m: ArrayLike<number>, p: number[]) => T) =>
  Array.from(list).flatMap((m) => S.samplePoints.map((p) => fn(m, p)));
const finite = (p: ArrayLike<number>) => Number.isFinite(p[0] + p[1] + p[2]);

// The engine sides that walk a list of their own, each built once: a `parElement` keeps its output
// array from call to call, so the timed call runs the walk and builds nothing.
const affinePoints = parElement(([m, p]: readonly [Float64Array, number[]], i) =>
  finite(p) ? transformAffinePoint(S.affinePointsOut[i], m, p[0], p[1], p[2]) : null,
);
const clipPoints = parElement(([m, p]: readonly [Float64Array, number[]], i) =>
  transformHomogeneousPoint(S.clips[i], m, p[0], p[1], p[2]),
);

async function lignesOperations(): Promise<Measurement[]> {
  return [
    await ligne(
      '4×4 product, double precision',
      'packages/sdk-core/src/math/matrix/matrix4.ts',
      'paires hostiles',
      pairs,
      (l) => l.map(([a, b]) => f64(new THREE.Matrix4().multiplyMatrices(m4(a), m4(b)).elements)),
      parElement(([a, b]: Float64Array[], i) => multiplyMatrix4(S.products[i], a, b)),
    ),
    await ligne(
      '4×4 product written on its input',
      'packages/sdk-core/src/math/matrix/matrix4.ts',
      'paires hostiles',
      pairs,
      (l) => l.map(([a, b]) => f64(m4(b).premultiply(m4(a)).elements)),
      parElement(([a, b]: Float64Array[], i) => {
        const out = S.inPlace[i];
        out.set(b);
        return multiplyMatrix4(out, a, out);
      }),
    ),
    await ligne(
      '4×4 product toward single precision',
      'packages/sdk-core/src/math/matrix/matrix4.ts',
      'paires arrondies',
      pairs32,
      (l) =>
        l.map(([a, b]) =>
          Float32Array.from(new THREE.Matrix4().multiplyMatrices(m4(a), m4(b)).elements),
        ),
      parElement(([a, b]: Float64Array[], i) => {
        S.singles[i].set(multiplyMatrix4(S.toSingle[i], a, b));
        return S.singles[i];
      }),
    ),
    await ligne(
      '4×4 inverse, singulars included',
      'packages/sdk-core/src/math/matrix/matrix4Inverse.ts',
      'matrices hostiles',
      matrices,
      (l) => l.map((m) => f64(m4(m).invert().elements)),
      parElement((m: Float64Array, i) => {
        const out = S.inverses[i];
        out.set(m);
        return invertMatrix4(out, out);
      }),
    ),
    await ligne(
      '4×4 determinant',
      'packages/sdk-core/src/math/matrix/matrix4.ts',
      'matrices hostiles',
      matrices,
      (l) => f64(l.map((m) => m4(m).determinant())),
      (l) => {
        for (let i = 0; i < l.length; i++) S.determinants[i] = determinantMatrix4(l[i]);
        return S.determinants;
      },
    ),
    await ligne(
      'matrice normale',
      'packages/sdk-core/src/math/matrix/matrix3.ts',
      'matrices hostiles',
      matrices,
      (l) => l.map((m) => referenceNormal(m4(m))),
      parElement((m: Float64Array, i) => normalMatrix3(S.normals[i], m)),
    ),
    await ligne(
      'TRS decomposition',
      'packages/sdk-core/src/math/matrix/matrix4Trs.ts',
      'matrices hostiles',
      matrices,
      (l) => l.map((m) => trsReference(m4(m))),
      parElement((m: Float64Array, i) => {
        decomposeMatrix4(m, ...S.decomposed[i]);
        return S.decomposed[i];
      }),
    ),
    await ligne(
      'point affine (matrice affine, point fini)',
      'packages/sdk-core/src/math/primitives/vector.ts',
      'poses × points',
      affines,
      (l) => crossed(l, (m, p) => (finite(p) ? f64(v3(p).applyMatrix4(m4(m)).toArray()) : null)),
      () => affinePoints(S.affineCrossings),
    ),
    await ligne(
      'homogeneous point in clip space',
      'packages/sdk-core/src/math/primitives/vector.ts',
      'matrices × points',
      matrices,
      (l) =>
        crossed(l, (m, p) =>
          f64(new THREE.Vector4(p[0], p[1], p[2], 1).applyMatrix4(m4(m)).toArray()),
        ),
      () => clipPoints(S.matrixCrossings),
    ),
    await ligne(
      'produits vectoriel et scalaire',
      'packages/sdk-core/src/math/primitives/vector.ts',
      'vecteurs hostiles',
      points,
      (l) =>
        l.map((p, i) => {
          const q = l[(i * 13 + 5) % l.length];
          return [f64(new THREE.Vector3().crossVectors(v3(p), v3(q)).toArray()), v3(p).dot(v3(q))];
        }),
      // The line's input is `points`: each vector crossed with the one the reference pairs it with.
      parElement((p: number[], i) => {
        const q = points[(i * 13 + 5) % points.length],
          out = S.crossDots[i];
        crossVector3(out[0] as Float64Array, p, q);
        out[1] = dotVector3(p, q);
        return out;
      }),
    ),
    await ligne(
      'node displacement: parent⁻¹ · world, then TRS',
      'packages/sdk-browser/src/webgpu/pages/render/transform.ts',
      'paires hostiles',
      pairs,
      (l) =>
        l.map(([parent, world]) =>
          trsReference(m4(world).premultiply(m4(parent).clone().invert())),
        ),
      parElement(([parent, world]: Float64Array[], i) => {
        const inverse = invertMatrix4(S.rests[i], parent),
          local = S.poses[i];
        local.set(world);
        decomposeMatrix4(multiplyMatrix4(local, inverse, local), ...S.displaced[i]);
        return S.displaced[i];
      }),
    ),
  ];
}

export const hierarchyNodes = chainesHostiles();

export async function lignesEquivalence(): Promise<Measurement[]> {
  return [
    ...(await lignesOperations()),
    await ligne(
      'hierarchies: world, position, quaternion, scale, determinant and sign, normal, inverse',
      'packages/sdk-core/src/math/matrix/matrix4Trs.ts',
      `${hierarchyNodes.length} nodes, depths 1 to 6 and branches`,
      hierarchyNodes,
      (l) => l.map(lectureReference),
      (l) => l.map(lectureSocle),
    ),
  ];
}
