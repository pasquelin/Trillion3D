import { parseKey, tileCorner, tileIndex, tileKey, type Grid, type TileKey } from './grid.ts';

/**
 * The heights the page fetches per tile, kept in memory by key. A fetch never blocks a frame: it
 * resolves into the store, and whatever asked for a height that has not arrived gets `null`.
 */
export type HeightStore = {
  grid: Grid;
  /** Samples per tile side; a tile holds `(samples + 1)²` heights, row-major from -X,-Z. */
  samples: number;
  tiles: Map<TileKey, Float32Array>;
  fetching: Set<TileKey>;
  /** Tiles that failed to arrive, kept so the stream does not ask again every frame. */
  failed: Set<TileKey>;
};

export function heightStore(grid: Grid, samples: number): HeightStore {
  return { grid, samples, tiles: new Map(), fetching: new Set(), failed: new Set() };
}

/** Starts the fetch of one tile; the result lands in the store whenever it arrives. */
export function fetchTile(
  store: HeightStore,
  key: TileKey,
  load: (tx: number, tz: number) => Promise<Float32Array>,
) {
  const [tx, tz] = parseKey(key);
  store.fetching.add(key);
  load(tx, tz)
    .then((heights) => {
      if (heights.length !== (store.samples + 1) ** 2)
        throw new Error(
          `heights ${key}: ${heights.length} values, not ${(store.samples + 1) ** 2}`,
        );
      store.tiles.set(key, heights);
    })
    .catch((error: unknown) => {
      store.failed.add(key);
      console.warn(error);
    })
    .finally(() => store.fetching.delete(key));
}

/** The ground height at (x, z), bilinear inside its tile's samples; `null` until it arrived. */
export function heightAt(store: HeightStore, x: number, z: number): number | null {
  const { grid, samples } = store;
  const tx = tileIndex(grid, x);
  const tz = tileIndex(grid, z);
  const heights = store.tiles.get(tileKey(tx, tz));
  if (!heights) return null;
  const [minX, minZ] = tileCorner(grid, tx, tz);
  const step = grid.tile / samples;
  const u = Math.min(samples - 1e-6, Math.max(0, (x - minX) / step));
  const v = Math.min(samples - 1e-6, Math.max(0, (z - minZ) / step));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const row = samples + 1;
  const at = (a: number, b: number) => heights[b * row + a];
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fu;
  const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu;
  return top + (bottom - top) * fv;
}
