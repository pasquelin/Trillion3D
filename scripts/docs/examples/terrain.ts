import { SceneGltf } from './gltf-scene.ts';
import { moved } from './mesh.ts';
import { icosphere } from './solids.ts';
import type { Mesh } from './mesh.ts';

/** Samples along each side of the valley, and the metres between two: 128 m square. */
const SIDE = 65,
  STEP = 2;

/** The valley's height at (x, z): two ridges and a basin, smooth enough to roll down. */
const height = (x: number, z: number) =>
  6 * Math.cos(x / 22) * Math.cos(z / 26) +
  2.5 * Math.sin((x + z) / 9) +
  0.0004 * (x * x + z * z) * 4;

/**
 * A regular grid of `side` × `side` samples `step` metres apart from `(x0, z0)`, lifted by
 * `height`, the shape the compiler cooks into a height field: heights on a 1/256 m grid, the
 * surface's normals, and (u, v) repeating every `tiling` steps.
 */
export function heightGrid(
  side: number,
  step: number,
  [x0, z0]: readonly [number, number],
  height: (x: number, z: number) => number,
  tiling: number,
): Mesh {
  const mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const [x, z] = [x0 + i * step, z0 + j * step];
      const e = 0.5;
      const [dx, dz] = [height(x + e, z) - height(x - e, z), height(x, z + e) - height(x, z - e)];
      const length = Math.hypot(dx, 2 * e, dz);
      mesh.positions.push(x, Math.round(height(x, z) * 256) / 256, z);
      mesh.normals.push(-dx / length, (2 * e) / length, -dz / length);
      mesh.uvs.push(i / tiling, j / tiling);
    }
  for (let j = 0; j < side - 1; j++)
    for (let i = 0; i < side - 1; i++) {
      const a = j * side + i;
      mesh.indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
  return mesh;
}

/** The valley, centred on the origin. */
const valley = () => {
  const corner = (-(SIDE - 1) / 2) * STEP;
  return heightGrid(SIDE, STEP, [corner, corner], height, 8);
};

/**
 * `terrain`: a valley on a two-metre grid and three boulders. The grid becomes a height field at
 * cook time, the boulders triangle tiles: `rolling-on-terrain` rolls balls down it.
 */
export async function writeTerrain(directory: string) {
  const gltf = new SceneGltf();
  const grass = gltf.material('grass', [0.33, 0.47, 0.24], { roughness: 0.9 }),
    stone = gltf.material('stone', [0.52, 0.5, 0.47], { roughness: 0.8 });
  const rock = icosphere(3, ([x, y, z]) => 1 + 0.15 * Math.sin(5 * x + 3 * y) * Math.cos(4 * z));
  const children = [gltf.node({ name: 'valley', mesh: gltf.mesh('valley', [[valley(), grass]]) })];
  for (const [x, z, size] of [
    [-12, 8, 3],
    [10, -14, 4],
    [18, 16, 2.5],
  ])
    children.push(
      gltf.node({
        name: 'boulder',
        mesh: gltf.mesh('boulder', [
          [moved(rock, [x, height(x, z), z], [size, size, size]), stone],
        ]),
      }),
    );
  gltf.node({ name: 'terrain', children }, true);
  await gltf.write(directory, 'terrain');
}
