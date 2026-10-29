// The CPU twin of the compute raster's binning and compaction (`hairBin`, `hairTileCompact`, `binnedWgsl.ts`): the threads of a group run one
// phase after another, as its barriers make them, each thread in turn within a phase.

import { HAIR_TILE_CHUNK } from './rasterLimits.ts'

/** A segment, by the cells it reaches. */
export interface BinSegment {
  readonly id: number
  readonly cells: readonly number[]
}

/** A tile the binners made: the cell it is in, its segments' room and how many it holds. */
export interface BinTile {
  cell: number
  count: number
  readonly prims: number[]
}

/** The tiles `binners` groups make of `segments` over `cellCount` cells, in batches of a group's threads, `maxTiles` at most. */
export function binSegments(
  segments: readonly BinSegment[],
  cellCount: number,
  binners: number,
  maxTiles: number,
): BinTile[] {
  const tiles: BinTile[] = []
  const counted = Array.from({ length: binners }, () => new Uint32Array(cellCount))
  const written = Array.from({ length: binners }, () => new Uint32Array(cellCount))
  const current = Array.from({ length: binners }, () => new Uint32Array(cellCount))
  const previous = Array.from({ length: binners }, () => new Uint32Array(cellCount))
  const batches = Math.ceil(segments.length / HAIR_TILE_CHUNK)
  const loops = Math.ceil(batches / binners)
  const mask = HAIR_TILE_CHUNK - 1
  for (let binner = 0; binner < binners; binner++)
    for (let round = 0; round < loops; round++) {
      const batch = round + binner * loops
      const mine =
        batch < batches
          ? segments.slice(batch * HAIR_TILE_CHUNK, (batch + 1) * HAIR_TILE_CHUNK)
          : []
      // Counted: the cells that cross into a new tile are listed.
      const allocation: number[] = []
      for (const { cells } of mine)
        for (const cell of cells) {
          const old = counted[binner]![cell]!
          counted[binner]![cell] = old + 1
          if (old % HAIR_TILE_CHUNK === 0) allocation.push(cell)
        }
      // Allocated: each listed cell is given a tile, the one it fills before closed if it was started.
      for (const cell of allocation) {
        const total = counted[binner]![cell]!
        const before = written[binner]![cell]!
        const oldCurrent = current[binner]![cell]!
        const tile = tiles.length
        let made = 0
        if (tile < maxTiles) {
          tiles.push({ cell, count: 0, prims: [] })
          made = tile + 1
        } else tiles.length++
        if (before > 0 && oldCurrent !== 0) tiles[oldCurrent - 1]!.count = HAIR_TILE_CHUNK
        previous[binner]![cell] = oldCurrent
        current[binner]![cell] = made
        void total
      }
      // Written: each segment goes to the tile its count says.
      for (const { id, cells } of mine)
        for (const cell of cells) {
          const total = counted[binner]![cell]!
          const old = written[binner]![cell]!
          written[binner]![cell] = old + 1
          const first = (total - 1) & ~mask
          const target = old < first ? previous[binner]![cell]! : current[binner]![cell]!
          if (target === 0) continue
          const tile = tiles[target - 1]!
          tile.prims[old & mask] = id
          if (old + 1 === total) tile.count = (old & mask) + 1
        }
    }
  return tiles.filter(Boolean)
}

/** The tiles of `tiles` compacted per cell into full ones: the last of a cell holds what is left. */
export function compactTiles(tiles: readonly BinTile[]): BinTile[] {
  const cells = new Map<number, number[]>()
  for (const tile of tiles) {
    const prims = cells.get(tile.cell) ?? []
    for (let k = 0; k < tile.count; k++) prims.push(tile.prims[k]!)
    cells.set(tile.cell, prims)
  }
  const out: BinTile[] = []
  for (const [cell, prims] of cells)
    for (let at = 0; at < prims.length; at += HAIR_TILE_CHUNK) {
      const chunk = prims.slice(at, at + HAIR_TILE_CHUNK)
      out.push({ cell, count: chunk.length, prims: chunk })
    }
  return out
}
