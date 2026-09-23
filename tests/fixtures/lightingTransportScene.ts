import type {
  Patch,
  Scene,
  Surface,
  Vec3,
} from '../../packages/sdk-core/src/lighting/scene/experimentScene.ts';
export function sceneWithBlocker(open: boolean, intensity: number): Scene {
  return sceneFromSurfaces([
    {
      id: 'receiver',
      origin: [0, -2, -2],
      u: [0, 4, 0],
      v: [0, 0, 4],
      albedo: [0.6, 0.25, 0.2],
      emission: [0, 0, 0],
      kind: 'diffuse',
      moving: false,
      columns: 2,
      rows: 2,
    },
    {
      id: 'emitter',
      origin: [2, -2, 2],
      u: [0, 4, 0],
      v: [0, 0, -4],
      albedo: [0.2, 0.2, 0.2],
      emission: [4 * intensity, intensity, 0.5 * intensity],
      kind: 'diffuse',
      moving: false,
      columns: 2,
      rows: 2,
    },
    {
      id: 'blocker',
      origin: [1, open ? 8 : -3, 3],
      u: [0, 6, 0],
      v: [0, 0, -6],
      albedo: [0, 0, 0],
      emission: [0, 0, 0],
      kind: 'diffuse',
      moving: true,
      columns: 1,
      rows: 1,
    },
  ]);
}

export function sceneFromSurfaces(surfaces: Surface[]): Scene {
  const patches: Patch[] = [];
  surfaces.forEach((surface, surfaceIndex) => {
    const u = surface.u.map((value) => value / surface.columns) as Vec3;
    const v = surface.v.map((value) => value / surface.rows) as Vec3;
    const cross: Vec3 = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const area = Math.hypot(...cross),
      normal = cross.map((value) => value / area) as Vec3;
    for (let row = 0; row < surface.rows; row++)
      for (let column = 0; column < surface.columns; column++) {
        const center = surface.origin.map(
          (value, axis) => value + (column + 0.5) * u[axis] + (row + 0.5) * v[axis],
        ) as Vec3;
        patches.push({
          id: patches.length,
          surface: surfaceIndex,
          center,
          u,
          v,
          normal,
          area,
          albedo: [...surface.albedo],
          emission: [...surface.emission],
        });
      }
  });
  return { surfaces, patches };
}
