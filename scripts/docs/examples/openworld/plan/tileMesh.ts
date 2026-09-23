/**
 * One terrain tile as a mesh (#332): its ground as one part — positions local to the tile's
 * corner node, normals from the shared height samples, and, when the ground wears a baked image,
 * texture coordinates that put each texel's centre on the world point it was baked at — then the
 * tile's flat parts (sea, lakes, rivers, roads) beside it.
 */
import { WORLD, type MeshPart, type PropMesh, type Surface } from './contract.ts';
import { TILE_GRID, TILE_STEP, type TileGrid } from './tileGrid.ts';
import type { FlatPart } from './water.ts';

/**
 * The texture coordinate of a local position along one axis, for a `size`-texel image whose first
 * and last texel centres sit on the tile's edges: always inside (0, 1).
 */
export const texelCoordinate = (local: number, size: number) =>
  (0.5 + (local / WORLD.tile) * (size - 1)) / size;

export function tileMesh(
  id: string,
  grid: TileGrid,
  triangles: readonly number[],
  flat: readonly FlatPart[],
  ground: Surface,
  textureSize: number,
): PropMesh {
  const remap = new Map<number, number>(),
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const m of triangles) {
    let at = remap.get(m);
    if (at === undefined) {
      const i = m % TILE_GRID,
        x = i * TILE_STEP,
        z = ((m - i) / TILE_GRID) * TILE_STEP;
      at = positions.length / 3;
      remap.set(m, at);
      positions.push(x, grid.vertex(m), z);
      normals.push(...grid.normal(m));
      uvs.push(texelCoordinate(x, textureSize), texelCoordinate(z, textureSize));
    }
    indices.push(at);
  }
  const parts: MeshPart[] = [
    {
      surface: ground,
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      ...(ground.texture ? { uvs: Float32Array.from(uvs) } : {}),
      indices: Uint32Array.from(indices),
    },
  ];
  for (const f of flat) {
    const count = f.positions.length / 3;
    parts.push({
      surface: f.surface,
      positions: Float32Array.from(f.positions),
      normals: Float32Array.from({ length: count * 3 }, (_, k) => (k % 3 === 1 ? 1 : 0)),
      indices: Uint32Array.from(f.indices),
    });
  }
  return { id, parts };
}

/** Adds the edges of a ground part's triangles that lie wholly above sea level to `into`. */
export function edgeStats(part: MeshPart, into: { sum: number; count: number; max: number }) {
  const { positions: p, indices } = part;
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k] * 3,
        b = indices[t + ((k + 1) % 3)] * 3;
      if (p[a + 1] < WORLD.seaLevel || p[b + 1] < WORLD.seaLevel) continue;
      const length = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
      into.sum += length;
      into.count++;
      into.max = Math.max(into.max, length);
    }
}
