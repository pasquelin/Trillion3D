import type { Scene, Vec3 } from './lightingSceneTypes.ts';
import { add, scale } from './lightingSceneMath.ts';

export function createLightingSphereGeometry(
  sphere: Pick<NonNullable<Scene['sphere']>, 'center' | 'radius'>,
) {
  const { center, radius } = sphere;
  const positions: number[] = [],
    normals: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const longitudeSegments = 64,
    latitudeSegments = 32;
  for (let y = 0; y <= latitudeSegments; y++)
    for (let x = 0; x <= longitudeSegments; x++) {
      const theta = (Math.PI * y) / latitudeSegments,
        phi = (2 * Math.PI * x) / longitudeSegments;
      const normal: Vec3 = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      positions.push(...add(center, scale(normal, radius)));
      normals.push(...normal);
      uv.push(x / longitudeSegments, 1 - y / latitudeSegments);
    }
  for (let y = 0; y < latitudeSegments; y++)
    for (let x = 0; x < longitudeSegments; x++) {
      const a = y * (longitudeSegments + 1) + x,
        b = a + longitudeSegments + 1,
        c = b + 1,
        d = a + 1;
      if (y < latitudeSegments - 1) indices.push(a, c, b);
      if (y > 0) indices.push(a, d, c);
    }
  return { positions, normals, uv, indices };
}
