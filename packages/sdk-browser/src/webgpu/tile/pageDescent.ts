import { tilesAt, type TileLayout } from '../../texture/tiles.ts';
import type { TileKey } from './pageTable.ts';

/**
 * Entries finer than a tile, under it, in a page table whose entries of this texture start at word
 * `at`: `visit` edits one and says whether the entries under it may still need an edit. A subtree
 * it refuses is pruned (STR-20, #961): an entry is never served coarser than its parent entry, so
 * under an entry served at the tile's level or finer nothing changes. A level's last column or row
 * may have no parent — 769 texels make 7 tiles, their half 3 —: such an orphan is reached from the
 * range the tile covers, as the full descent did.
 */
export function descendTile(
  { width, height, offsets }: TileLayout,
  at: number,
  key: TileKey,
  visit: (index: number) => boolean,
) {
  // Each level's tiles, once per descent, as the full descent read them.
  const grid = Array.from({ length: key.level }, (_, level) => tilesAt(width, height, level));
  const children = (level: number, x: number, y: number) => {
    const [tw, th] = grid[level];
    for (let cy = y * 2; cy < Math.min(th, y * 2 + 2); cy++)
      for (let cx = x * 2; cx < Math.min(tw, x * 2 + 2); cx++) down(level, cx, cy, tw);
  };
  const down = (level: number, x: number, y: number, tw: number) => {
    if (visit(at + offsets[level] + y * tw + x) && level > 0) children(level - 1, x, y);
  };
  if (key.level > 0) children(key.level - 1, key.tx, key.ty);
  for (let level = key.level - 2; level >= 0; level--) {
    const shift = key.level - level,
      [tw, th] = grid[level],
      [pw, ph] = grid[level + 1];
    const x0 = key.tx << shift,
      y0 = key.ty << shift,
      x1 = Math.min(tw, (key.tx + 1) << shift),
      y1 = Math.min(th, (key.ty + 1) << shift);
    if (x1 <= pw * 2 && y1 <= ph * 2) continue;
    for (let y = y0; y < y1; y++)
      for (let x = y >> 1 < ph ? Math.max(x0, pw * 2) : x0; x < x1; x++) down(level, x, y, tw);
  }
}
