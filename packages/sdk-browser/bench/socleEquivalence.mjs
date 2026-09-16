// Première partie du banc du socle, contre la référence : chaque fonction opposée à la méthode
// qu'elle remplace, sur les entrées hostiles, puis les hiérarchies parent/enfant nœud par nœud. Une
// seule valeur différente au sens d'`Object.is` et la ligne tombe.
import * as THREE from 'three';
import {
  crossVector3,
  determinantMatrix4,
  dotVector3,
  invertMatrix4,
  multiplyMatrix4,
  normalMatrix3,
  transformAffinePoint,
  transformHomogeneousPoint,
} from '../../sdk-core/index.ts';
import { chainesHostiles, lectureReference, lectureSocle } from './socleHierarchie.mjs';
import { f64, ligne, m4, trs, trsReference } from './socleLigne.mjs';
import { affines, matrices, paires, paires32, points } from './scenesSocle.mjs';

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const echantillon = points.filter((_, i) => i % 29 === 0);
/** Chaque matrice contre chaque point de l'échantillon. */
const croise = (liste, fn) => liste.flatMap((m) => echantillon.map((p) => fn(m, p)));
const fini = (p) => Number.isFinite(p[0] + p[1] + p[2]);

async function lignesOperations() {
  return [
    await ligne(
      'produit 4×4, double précision',
      'packages/sdk-core/mathMatrix4.ts',
      'paires hostiles',
      paires,
      (l) => l.map(([a, b]) => f64(new THREE.Matrix4().multiplyMatrices(m4(a), m4(b)).elements)),
      (l) => l.map(([a, b]) => multiplyMatrix4(new Float64Array(16), a, b)),
    ),
    await ligne(
      'produit 4×4 écrit sur son entrée',
      'packages/sdk-core/mathMatrix4.ts',
      'paires hostiles',
      paires,
      (l) => l.map(([a, b]) => f64(m4(b).premultiply(m4(a)).elements)),
      (l) =>
        l.map(([a, b]) => {
          const out = f64(b);
          return multiplyMatrix4(out, a, out);
        }),
    ),
    await ligne(
      'produit 4×4 vers la simple précision',
      'packages/sdk-core/mathMatrix4.ts',
      'paires arrondies',
      paires32,
      (l) =>
        l.map(([a, b]) =>
          Float32Array.from(new THREE.Matrix4().multiplyMatrices(m4(a), m4(b)).elements),
        ),
      (l) => l.map(([a, b]) => multiplyMatrix4(new Float32Array(16), a, b)),
    ),
    await ligne(
      'inverse 4×4, singulières comprises',
      'packages/sdk-core/mathMatrix4Inverse.ts',
      'matrices hostiles',
      matrices,
      (l) => l.map((m) => f64(m4(m).invert().elements)),
      (l) =>
        l.map((m) => {
          const out = f64(m);
          return invertMatrix4(out, out);
        }),
    ),
    await ligne(
      'déterminant 4×4',
      'packages/sdk-core/mathMatrix4.ts',
      'matrices hostiles',
      matrices,
      (l) => f64(l.map((m) => m4(m).determinant())),
      (l) => f64(l.map((m) => determinantMatrix4(m))),
    ),
    await ligne(
      'matrice normale',
      'packages/sdk-core/mathMatrix3.ts',
      'matrices hostiles',
      matrices,
      (l) => l.map((m) => f64(new THREE.Matrix3().getNormalMatrix(m4(m)).elements)),
      (l) => l.map((m) => normalMatrix3(new Float64Array(9), m)),
    ),
    await ligne(
      'décomposition TRS',
      'packages/sdk-core/mathMatrix4Trs.ts',
      'matrices hostiles',
      matrices,
      (l) => l.map((m) => trsReference(m4(m))),
      (l) => l.map((m) => trs(m)),
    ),
    await ligne(
      'point affine (matrice affine, point fini)',
      'packages/sdk-core/mathVector.ts',
      'poses × points',
      affines,
      (l) => croise(l, (m, p) => (fini(p) ? f64(v3(p).applyMatrix4(m4(m)).toArray()) : null)),
      (l) =>
        croise(l, (m, p) =>
          fini(p) ? transformAffinePoint(new Float64Array(3), m, p[0], p[1], p[2]) : null,
        ),
    ),
    await ligne(
      'point homogène en espace de découpe',
      'packages/sdk-core/mathVector.ts',
      'matrices × points',
      matrices,
      (l) =>
        croise(l, (m, p) =>
          f64(new THREE.Vector4(p[0], p[1], p[2], 1).applyMatrix4(m4(m)).toArray()),
        ),
      (l) =>
        croise(l, (m, p) => transformHomogeneousPoint(new Float64Array(4), m, p[0], p[1], p[2])),
    ),
    await ligne(
      'produits vectoriel et scalaire',
      'packages/sdk-core/mathVector.ts',
      'vecteurs hostiles',
      points,
      (l) =>
        l.map((p, i) => {
          const q = l[(i * 13 + 5) % l.length];
          return [f64(new THREE.Vector3().crossVectors(v3(p), v3(q)).toArray()), v3(p).dot(v3(q))];
        }),
      (l) =>
        l.map((p, i) => {
          const q = l[(i * 13 + 5) % l.length];
          return [crossVector3(new Float64Array(3), p, q), dotVector3(p, q)];
        }),
    ),
    await ligne(
      'déplacement de nœud : parent⁻¹ · monde, puis TRS',
      'packages/sdk-browser/webgpuPagesTransform.ts',
      'paires hostiles',
      paires,
      (l) =>
        l.map(([parent, monde]) =>
          trsReference(m4(monde).premultiply(m4(parent).clone().invert())),
        ),
      (l) =>
        l.map(([parent, monde]) => {
          const inverse = invertMatrix4(new Float64Array(16), parent),
            local = f64(monde);
          return trs(multiplyMatrix4(local, inverse, local));
        }),
    ),
    await ligne(
      "pose de repos de l'observation : base⁻¹ · monde, puis base · repos",
      'packages/sdk-browser/lightingObservationMeshes.ts',
      'paires hostiles',
      paires,
      (l) =>
        l.map(([base, monde]) => {
          const repos = m4(base).clone().invert().multiply(m4(monde));
          return f64(new THREE.Matrix4().multiplyMatrices(m4(base), repos).elements);
        }),
      (l) =>
        l.map(([base, monde]) => {
          const repos = invertMatrix4(new Float64Array(16), base);
          multiplyMatrix4(repos, repos, monde);
          return multiplyMatrix4(new Float64Array(16), base, repos);
        }),
    ),
  ];
}

export const noeudsHierarchie = chainesHostiles();

export async function lignesEquivalence() {
  return [
    ...(await lignesOperations()),
    await ligne(
      'hiérarchies : monde, position, quaternion, échelle, déterminant et signe, normale, inverse',
      'packages/sdk-core/mathMatrix4Trs.ts',
      `${noeudsHierarchie.length} nœuds, profondeurs 1 à 6 et branches`,
      noeudsHierarchie,
      (l) => l.map(lectureReference),
      (l) => l.map(lectureSocle),
    ),
  ];
}
