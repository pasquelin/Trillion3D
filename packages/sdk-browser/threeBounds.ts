/**
 * Passage entre les boîtes à plat de sdk-core et les bornes que porte une géométrie Three.js. Aucun
 * calcul ici : les volumes se calculent dans `mathBox.ts` et `mathSphere.ts`, ce module ne fait que
 * recopier des bornes dans les objets que le moteur de rendu Three lit encore.
 */
import { sphereFromBounds } from '../sdk-core/index.ts';
import * as THREE from 'three';

/** Recopie les six bornes d'une boîte Three.js à plat. */
export function readThreeBox(out: Float64Array, box: THREE.Box3) {
  out[0] = box.min.x;
  out[1] = box.min.y;
  out[2] = box.min.z;
  out[3] = box.max.x;
  out[4] = box.max.y;
  out[5] = box.max.z;
}

const sphere = new Float64Array(4);

/** Pose la boîte et la sphère englobantes d'une géométrie depuis ses bornes. */
export function setGeometryBounds(
  geometry: THREE.BufferGeometry,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  const minX = min[0],
    minY = min[1],
    minZ = min[2],
    maxX = max[0],
    maxY = max[1],
    maxZ = max[2];
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ),
  );
  sphereFromBounds(sphere, 0, minX, minY, minZ, maxX, maxY, maxZ);
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(sphere[0], sphere[1], sphere[2]),
    sphere[3],
  );
}
