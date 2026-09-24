/**
 * Bounds written back into a page geometry, as the reference computes them: a box from its two
 * corners and the sphere around it. No computation here: the sphere comes from
 * `packages/sdk-core/src/math/primitives/sphere.ts`, the box and the sphere are the core's own
 * (`Box3`, `Sphere`), and reading a host box needs no library at all (`boxBounds.ts`).
 */
import { sphereFromBounds } from '../../../sdk-core/src/index.ts';
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts';
import { Sphere } from '../../../sdk-core/src/world/math/volumes.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';

const sphere = new Float64Array(4);

/** Set a geometry's bounding box and sphere from its bounds. */
export function setGeometryBounds(
  geometry: { boundingBox: unknown; boundingSphere: unknown },
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  const minX = min[0],
    minY = min[1],
    minZ = min[2],
    maxX = max[0],
    maxY = max[1],
    maxZ = max[2];
  geometry.boundingBox = new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
  sphereFromBounds(sphere, 0, minX, minY, minZ, maxX, maxY, maxZ);
  geometry.boundingSphere = new Sphere(new Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]);
}
