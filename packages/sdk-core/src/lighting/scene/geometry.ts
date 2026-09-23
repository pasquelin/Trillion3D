import type { Patch, Surface, Vec3 } from './types.ts';
import { add, scale, cross, length, normalized, BLACK } from './math.ts';

type Face = 'nx' | 'px' | 'ny' | 'py' | 'nz' | 'pz';

export function createLightingSceneGeometry(patchSize: number) {
  const surfaces: Surface[] = [];
  let patchCount = 0;
  const rectangle = (
    id: string,
    origin: Vec3,
    u: Vec3,
    v: Vec3,
    albedo: Vec3,
    detailed = true,
    moving = false,
    kind: Surface['kind'] = 'diffuse',
    emission: Vec3 = BLACK,
  ): void => {
    const columns = detailed ? Math.max(1, Math.ceil(length(u) / patchSize - 1e-10)) : 1;
    const rows = detailed ? Math.max(1, Math.ceil(length(v) / patchSize - 1e-10)) : 1;
    patchCount += columns * rows;
    if (patchCount > 16_384) throw new RangeError('Lighting scene exceeds 16384 transport patches');
    surfaces.push({
      id,
      origin,
      u,
      v,
      albedo: [...albedo],
      emission: [...emission],
      kind,
      moving,
      columns,
      rows,
    });
  };
  const box = (
    id: string,
    min: Vec3,
    max: Vec3,
    albedo: Vec3,
    detailed: Face[],
    moving = false,
    point: (v: Vec3) => Vec3 = (v) => v,
    vector: (v: Vec3) => Vec3 = (v) => v,
  ): void => {
    const [x, y, z] = min;
    const [X, Y, Z] = max;
    const dx = X - x,
      dy = Y - y,
      dz = Z - z;
    const faces: [Face, Vec3, Vec3, Vec3][] = [
      ['nx', [x, y, z], [0, 0, dz], [0, dy, 0]],
      ['px', [X, y, Z], [0, 0, -dz], [0, dy, 0]],
      ['ny', [x, y, z], [dx, 0, 0], [0, 0, dz]],
      ['py', [x, Y, Z], [dx, 0, 0], [0, 0, -dz]],
      ['nz', [X, y, z], [-dx, 0, 0], [0, dy, 0]],
      ['pz', [x, y, Z], [dx, 0, 0], [0, dy, 0]],
    ];
    for (const [face, origin, u, v] of faces)
      rectangle(
        `${id}_${face}`,
        point(origin),
        vector(u),
        vector(v),
        albedo,
        detailed.includes(face),
        moving,
      );
  };

  return { surfaces, rectangle, box };
}

export function createLightingScenePatches(surfaces: Surface[]): Patch[] {
  const patches: Patch[] = [];
  surfaces.forEach((surface, surfaceIndex) => {
    const u = scale(surface.u, 1 / surface.columns),
      v = scale(surface.v, 1 / surface.rows);
    const normal = normalized(cross(surface.u, surface.v));
    const area = length(cross(u, v));
    for (let row = 0; row < surface.rows; row++)
      for (let column = 0; column < surface.columns; column++) {
        patches.push({
          id: patches.length,
          surface: surfaceIndex,
          center: add(surface.origin, add(scale(u, column + 0.5), scale(v, row + 0.5))),
          normal: [...normal],
          u: [...u],
          v: [...v],
          area,
          albedo: [...(surface.kind === 'mirror' ? BLACK : surface.albedo)],
          emission: [...surface.emission],
        });
      }
  });
  return patches;
}
