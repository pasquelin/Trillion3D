import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SceneGltf } from './gltf-scene.ts';
import type { Mesh } from './mesh.ts';
import { png, raster } from './raster.ts';

/** Tiles along each side, quads along a tile's side and the metres between two samples: the
 *  open world's terrain in small, each tile a mesh and a node of its own. */
const TILES = 3,
  QUADS = 32,
  SPACING = 8;

/** The height at (x, z), in metres: two ridges and a flat valley floor, so the simplification
 *  meets both slopes and a plane. */
const height = (x: number, z: number) =>
  Math.max(Math.sin(x * 0.011) * Math.sin(z * 0.017 + 1) * 60, -10) + 40;

/** The tile whose corner stands at (x0, z0): positions from that corner, the surface's normals
 *  and texture coordinates across the tile, as a terrain generator writes them. */
function tile(x0: number, z0: number): Mesh {
  const side = QUADS + 1,
    mesh: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const [x, z] = [i * SPACING, j * SPACING];
      const at = (dx: number, dz: number) => height(x0 + x + dx, z0 + z + dz);
      const [sx, sz] = [at(1, 0) - at(-1, 0), at(0, 1) - at(0, -1)],
        length = Math.hypot(sx, 2, sz);
      mesh.positions.push(x, at(0, 0), z);
      mesh.normals.push(-sx / length, 2 / length, -sz / length);
      mesh.uvs.push(i / QUADS, j / QUADS);
    }
  for (let j = 0; j < QUADS; j++)
    for (let i = 0; i < QUADS; i++) {
      const a = j * side + i;
      mesh.indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
  return mesh;
}

/**
 * `terrain-tiles`: a textured terrain cooked tile by tile, the open world's terrain path in a
 * scene that loads in seconds (#414). `see-the-triangles?model=terrain-tiles` opens its cook,
 * `?model=terrain-tiles-none` its exact one; the compiler's tests cook it on both.
 */
export async function writeTerrainTiles(directory: string) {
  const gltf = new SceneGltf();
  const ground = gltf.material('ground', [1, 1, 1], { roughness: 0.9, texture: 'ground.png' });
  for (let row = 0; row < TILES; row++)
    for (let column = 0; column < TILES; column++) {
      const [x, z] = [column, row].map((k) => k * QUADS * SPACING),
        name = `tile ${column}_${row}`;
      gltf.node(
        { name, mesh: gltf.mesh(name, [[tile(x, z), ground]]), translation: [x, 0, z] },
        true,
      );
    }
  await gltf.write(directory, 'terrain-tiles');
  await writeFile(resolve(directory, 'ground.png'), png(raster(8, [90, 120, 60])));
}
