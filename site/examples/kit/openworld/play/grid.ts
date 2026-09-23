/**
 * The tile grid the physics streams by, and the plan of one streaming step: which tiles to
 * fetch, which to build into bodies, which to release. Pure, so the bound is tested in Node.
 *
 * Tile (tx, tz) covers x in [tx·tile − size/2, (tx+1)·tile − size/2), the same for z; indices run
 * from 0 to size/tile − 1 and name `heights/<tx>_<tz>.bin`.
 */
export type Grid = { size: number; tile: number };
export type TileKey = `${number}_${number}`;

export const tileKey = (tx: number, tz: number): TileKey => `${tx}_${tz}`;

export function parseKey(key: TileKey): [number, number] {
  const [tx, tz] = key.split('_').map(Number);
  return [tx, tz];
}

export const tileIndex = (grid: Grid, coordinate: number) =>
  Math.floor((coordinate + grid.size / 2) / grid.tile);

/** The tile's -X,-Z corner, in world metres. */
export const tileCorner = (grid: Grid, tx: number, tz: number): [number, number] => [
  tx * grid.tile - grid.size / 2,
  tz * grid.tile - grid.size / 2,
];

/** Distance from (x, z) to the nearest point of the tile, 0 inside it. */
export function tileDistance(grid: Grid, tx: number, tz: number, x: number, z: number) {
  const [minX, minZ] = tileCorner(grid, tx, tz);
  const dx = Math.max(minX - x, 0, x - (minX + grid.tile));
  const dz = Math.max(minZ - z, 0, z - (minZ + grid.tile));
  return Math.hypot(dx, dz);
}

/** Every tile of the map within `radius` of (x, z), nearest first. */
export function tilesAround(grid: Grid, x: number, z: number, radius: number): TileKey[] {
  const count = grid.size / grid.tile;
  const reach = (value: number, sign: number) =>
    Math.min(count - 1, Math.max(0, tileIndex(grid, value + sign * radius)));
  const found: [number, TileKey][] = [];
  for (let tz = reach(z, -1); tz <= reach(z, 1); tz++)
    for (let tx = reach(x, -1); tx <= reach(x, 1); tx++) {
      const distance = tileDistance(grid, tx, tz, x, z);
      if (distance <= radius) found.push([distance, tileKey(tx, tz)]);
    }
  return found.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1)).map(([, key]) => key);
}

export type StreamState = {
  /** Heights held in memory, whether or not a body is built from them. */
  cached: ReadonlySet<TileKey>;
  /** Fetches in flight. */
  fetching: ReadonlySet<TileKey>;
  /** Tiles whose bodies are in the physics world. */
  built: ReadonlySet<TileKey>;
  /** Tiles whose fetch failed: not asked for again. */
  failed?: ReadonlySet<TileKey>;
};

export type StreamLimits = {
  /** Bodies exist within this radius of the player, metres. */
  radius: number;
  /** Seconds of travel whose tiles are fetched ahead of the player. */
  lookahead: number;
  /** Fetches in flight at once. */
  fetches: number;
  /** Bodies built in one frame, so a frame never pays for a whole ring. */
  builds: number;
  /** Heights kept in memory at most, far ones dropped first. */
  cache: number;
};

export type StreamPlan = {
  fetch: TileKey[];
  build: TileKey[];
  release: TileKey[];
  evict: TileKey[];
};

/**
 * One streaming step for a player at (x, z) moving at (vx, vz) m/s. Bodies: the tiles within the
 * radius; released once a tile is farther than the radius plus half a tile, so a player on a
 * border does not make a tile flicker. Heights: those tiles, then the tiles around the point the
 * player reaches in `lookahead` seconds, fetched before they are needed.
 */
export function planStream(
  grid: Grid,
  at: { x: number; z: number; vx: number; vz: number },
  state: StreamState,
  limits: StreamLimits,
): StreamPlan {
  const near = tilesAround(grid, at.x, at.z, limits.radius);
  const ahead = tilesAround(
    grid,
    at.x + at.vx * limits.lookahead,
    at.z + at.vz * limits.lookahead,
    limits.radius,
  );
  const wanted = [...new Set([...near, ...ahead])];
  const slots = Math.max(0, limits.fetches - state.fetching.size);
  const fetch = wanted.filter(
    (key) => !state.cached.has(key) && !state.fetching.has(key) && !state.failed?.has(key),
  );
  const build = near.filter((key) => state.cached.has(key) && !state.built.has(key));
  const keep = limits.radius + grid.tile / 2;
  const far = (key: TileKey) => tileDistance(grid, ...parseKey(key), at.x, at.z);
  const release = [...state.built].filter((key) => far(key) > keep);
  const kept = new Set(wanted);
  const evict = [...state.cached]
    .filter((key) => !kept.has(key) && !state.built.has(key))
    .sort((a, b) => far(b) - far(a))
    .slice(0, Math.max(0, state.cached.size - limits.cache));
  return { fetch: fetch.slice(0, slots), build: build.slice(0, limits.builds), release, evict };
}
