import { MATERIAL_TILE_SIZE } from '../../visibility/shader/materialTilesWgsl.ts';
import { materialTilesOn } from './materialTiles.ts';

/**
 * The classification's lists as the pass leaves them, on the CPU: for each slot, the tiles of a
 * `width` × `height` image holding a pixel `slotAt(x, y)` puts in that slot — in tile order, where
 * the GPU's order is its atomics' own. `slots` past the lists (`slotAt` at or above `slots`) mark
 * nothing.
 */
export function classifyTiles(
  width: number,
  height: number,
  slots: number,
  slotAt: (x: number, y: number) => number,
) {
  const tilesX = materialTilesOn(width),
    tilesY = materialTilesOn(height);
  const lists: number[][] = Array.from({ length: slots }, () => []);
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const held = new Set<number>();
      for (
        let y = ty * MATERIAL_TILE_SIZE;
        y < Math.min(height, (ty + 1) * MATERIAL_TILE_SIZE);
        y++
      )
        for (
          let x = tx * MATERIAL_TILE_SIZE;
          x < Math.min(width, (tx + 1) * MATERIAL_TILE_SIZE);
          x++
        )
          held.add(slotAt(x, y));
      for (const slot of held) if (slot < slots) lists[slot].push(ty * tilesX + tx);
    }
  return { lists, tilesX, tilesY };
}

/** Fragments the class passes rasterise over the image: `full`, one full screen per class drawn
 *  (the triangle's), and `tiled`, the pixels of the tiles each class lists (`classifyTiles`). */
export function classFragments(width: number, height: number, lists: number[][]) {
  const tilesX = materialTilesOn(width);
  const pixelsOf = (tile: number) => {
    const x = (tile % tilesX) * MATERIAL_TILE_SIZE,
      y = Math.floor(tile / tilesX) * MATERIAL_TILE_SIZE;
    return (
      (Math.min(width, x + MATERIAL_TILE_SIZE) - x) * (Math.min(height, y + MATERIAL_TILE_SIZE) - y)
    );
  };
  const drawn = lists.filter((list) => list.length);
  return {
    full: drawn.length * width * height,
    tiled: drawn.reduce((sum, list) => sum + list.reduce((n, tile) => n + pixelsOf(tile), 0), 0),
  };
}
