import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SceneGltf } from './gltf-scene.ts';
import { png, raster } from './raster.ts';
import { heightGrid } from './terrain.ts';

/** Tiles along each side, quads along a tile's side and the metres between two samples: the
 *  open world's terrain in small, each tile a mesh and a node of its own. */
const TILES = 3,
  QUADS = 32,
  SPACING = 8;

/** The height at (x, z), in metres: two ridges and a flat valley floor, so the simplification
 *  meets both slopes and a plane. */
const height = (x: number, z: number) =>
  Math.max(Math.sin(x * 0.011) * Math.sin(z * 0.017 + 1) * 60, -10) + 40;

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
      // Positions from the tile's corner, heights from the one terrain across every tile.
      const tile = heightGrid(QUADS + 1, SPACING, [0, 0], (u, v) => height(x + u, z + v), QUADS);
      gltf.node({ name, mesh: gltf.mesh(name, [[tile, ground]]), translation: [x, 0, z] }, true);
    }
  await gltf.write(directory, 'terrain-tiles');
  await writeFile(resolve(directory, 'ground.png'), png(raster(8, [90, 120, 60])));
}
