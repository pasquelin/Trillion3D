/**
 * The terrain tiles (#332): 50 × 50 tiles of 1 km, each its own mesh placed by its own node at
 * its −X, −Z corner. Each tile is a right-triangulated irregular network over the same height
 * function; one error threshold, shared by the whole map, decides every split. All land
 * weighs the same — a walker may stand anywhere — and only the ground under the sea fades to
 * nothing over its first metre. Where two tiles meet, each takes the other's border vertices
 * too, so their edges hold the same vertices at the same heights and no crack opens. Every tile
 * that is not deep sea wears one baked base colour image (`bake.ts`); the terrain's share of the
 * cache is split between those images and the triangles (`resolution.ts`).
 */
import { TERRAIN_BYTES } from './budget.ts';
import { bakeTile } from './bake.ts';
import { BINS_PER_OCTAVE, conform, countTriangles, thresholdCurve, type Tile } from './conform.ts';
import { WORLD, type Instance, type PropMesh, type RegionModule } from './contract.ts';
import { groundColour } from './paint.ts';
import type { TerrainPlan } from './plan.ts';
import { splitTerrain } from './resolution.ts';
import { extract, hierarchy, propagate } from './rtin.ts';
import { pathIndex } from './stamp.ts';
import { SURFACE } from './surfaces.ts';
import { TileGrid, TILE_GRID } from './tileGrid.ts';
import { edgeStats, tileMesh } from './tileMesh.ts';
import { flatParts, seaQuad } from './water.ts';

const TILES = WORLD.size / WORLD.tile;

/** A block of tiles by index, inclusive: the whole map unless a preview asks for less. */
export type TileWindow = { minTx: number; minTz: number; maxTx: number; maxTz: number };
const WHOLE: TileWindow = { minTx: 0, minTz: 0, maxTx: TILES - 1, maxTz: TILES - 1 };

/**
 * Every terrain tile's mesh and node, and the figures the build reached. A `window` builds only
 * that block, with the budget share its tile count earns.
 */
export function terrainTiles(
  plan: TerrainPlan,
  regions: readonly RegionModule[] = [],
  window = WHOLE,
  /** False skips the image bake (a budget check needs the meshes only); the meshes still name it. */
  bake = true,
) {
  const shape = hierarchy(TILE_GRID),
    tiles: Tile[] = [],
    columns = window.maxTx - window.minTx + 1,
    bytes = Math.floor((TERRAIN_BYTES * columns * (window.maxTz - window.minTz + 1)) / TILES ** 2);
  for (let tz = window.minTz; tz <= window.maxTz; tz++)
    for (let tx = window.minTx; tx <= window.maxTx; tx++) {
      const grid = new TileGrid(tx, tz, plan.height),
        deep = isDeep(plan, grid);
      if (deep) {
        tiles.push({ grid, errors: null, deep });
        continue;
      }
      grid.fill();
      const height = (m: number) => grid.vertex(m),
        wet = (m: number) => Math.max(0, Math.min(1, 1 + height(m) - WORLD.seaLevel));
      tiles.push({
        grid,
        deep,
        errors: propagate(shape, new Float32Array(TILE_GRID ** 2), height, wet),
      });
    }
  // Fixed parts first: ribbons, lakes and one sea quad per tile that reaches below sea level.
  const wet = tiles.map((tile) => tile.deep || tile.grid.minimum() < WORLD.seaLevel),
    keys = new Set(tiles.map(({ grid }) => `${grid.tx}_${grid.tz}`)),
    flat =
      [...flatParts(plan, 0)].reduce(
        (sum, [key, list]) =>
          sum + (keys.has(key) ? list.reduce((n, p) => n + p.indices.length / 3, 0) : 0),
        0,
      ) +
      2 * wet.filter(Boolean).length;
  const textured = tiles.filter((tile) => !tile.deep).length,
    split = splitTerrain(bytes, textured, flat, thresholdCurve(tiles)),
    budget = split.triangles;
  let threshold = thresholdCurve(tiles)(budget - flat);
  for (;;) {
    const errors = conform(tiles, shape, threshold, columns),
      ground = errors.reduce((sum, e) => sum + (e ? countTriangles(e, threshold) : 2), 0);
    if (ground + flat <= budget) {
      // A road ribbon floats over the most its levelled ground may be missed by: the threshold
      // (land weighs one), plus a few centimetres.
      const parts = flatParts(plan, threshold + 0.05),
        meshes: PropMesh[] = [],
        instances: Instance[] = [],
        textures = bakeAll(plan, regions, tiles, bake ? split.size : 0),
        edges = { sum: 0, count: 0, max: 0 };
      tiles.forEach((tile, index) => {
        const { tx, tz, x0, z0 } = tile.grid,
          id = `terrain/${tx}_${tz}`,
          triangles = extract(
            TILE_GRID,
            errors[index] ?? new Float32Array(TILE_GRID ** 2),
            threshold,
          ),
          extra = [...(parts.get(`${tx}_${tz}`) ?? [])];
        if (wet[index]) extra.push(seaQuad());
        const ground = tile.deep
            ? SURFACE.seabed
            : { ...textures.surface, name: id, texture: tileTexture(tx, tz) },
          mesh = tileMesh(id, tile.grid, triangles, extra, ground, split.size);
        meshes.push(mesh);
        if (!tile.deep) edgeStats(mesh.parts[0], edges);
        instances.push({ prop: id, position: [x0, 0, z0], yaw: 0, name: `terrain-${tx}_${tz}` });
      });
      const stats = {
        threshold,
        triangles: ground + flat,
        ground,
        flat,
        textureSize: split.size,
        texelsPerMetre: (split.size - 1) / WORLD.tile,
        textureBytes: split.textureBytes,
        landEdge: { mean: edges.sum / Math.max(1, edges.count), max: edges.max },
      };
      return { meshes, instances, textures: textures.images, stats };
    }
    threshold *= 2 ** (1 / BINS_PER_OCTAVE);
  }
}

/** A tile whose coarse samples all lie a few metres under the sea: its ground is never seen. */
function isDeep(plan: TerrainPlan, grid: TileGrid): boolean {
  for (let j = 0; j <= 8; j++)
    for (let i = 0; i <= 8; i++)
      if (plan.height(grid.x0 + (i * WORLD.tile) / 8, grid.z0 + (j * WORLD.tile) / 8) > -3)
        return false;
  return true;
}

/** The file name of a tile's baked image in the source folder. */
const tileTexture = (tx: number, tz: number) => `terrain-${tx}_${tz}.png`;

/**
 * Every textured tile's image, by file name, and the surface they share: one roughness, the mean
 * over the whole block, so no tile edge changes how light glints off the ground.
 */
function bakeAll(
  plan: TerrainPlan,
  regions: readonly RegionModule[],
  tiles: readonly Tile[],
  size: number,
) {
  const colour = groundColour(plan.subSeed('terrain/paint'), regions),
    paths = pathIndex(plan),
    seed = plan.subSeed('terrain/grain'),
    images = new Map<string, { size: number; rgba: Uint8Array }>();
  let roughness = 0;
  for (const { grid, deep } of tiles) {
    if (deep || !size) continue;
    const baked = bakeTile(plan.height, plan.erosion, colour, paths, seed, grid.tx, grid.tz, size);
    images.set(tileTexture(grid.tx, grid.tz), { size, rgba: baked.rgba });
    roughness += baked.roughness;
  }
  const surface = {
    color: [1, 1, 1, 1] as const,
    metalness: 0,
    roughness: images.size ? roughness / images.size : 1,
  };
  return { images, surface };
}
