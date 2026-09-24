/**
 * Bounds written back INTO a Three.js geometry, for the witnesses whose pages are host
 * geometries. No computation here: the sphere comes from `packages/sdk-core/src/math/primitives/sphere.ts`, and reading a host
 * box needs no library at all (`../boxBounds.ts`).
 */
import { sphereFromBounds } from '../../../../sdk-core/src/index.ts';
import * as THREE from 'three';

const sphere = new Float64Array(4);

/** Set a geometry's bounding box and sphere from its bounds. */
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
