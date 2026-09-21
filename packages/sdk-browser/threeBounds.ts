/**
 * Bridge between sdk-core's flat boxes and the bounds a Three.js geometry carries. No
 * computation here: volumes are computed in `mathBox.ts` and `mathSphere.ts`; this module only
 * copies bounds into the objects the Three renderer still reads.
 */
import { sphereFromBounds } from '../sdk-core/index.ts';
import * as THREE from 'three';
import type { HostPoint } from './hostResources.ts';

/** A local or world box of the host, read by its two corners. */
export type HostBox = { readonly min: HostPoint; readonly max: HostPoint };

/** Copy the six bounds of a host box into a flat array. */
export function readThreeBox(out: Float64Array, box: HostBox) {
  out[0] = box.min.x;
  out[1] = box.min.y;
  out[2] = box.min.z;
  out[3] = box.max.x;
  out[4] = box.max.y;
  out[5] = box.max.z;
}

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
