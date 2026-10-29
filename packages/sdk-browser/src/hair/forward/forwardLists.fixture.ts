import { FORWARD_TILE_PRIMS, FORWARD_WALK_STEPS } from './forwardMath.ts'

/**
 * The binners' bookkeeping of the lists of one tile, in JavaScript on the formulas of the WGSL (`forwardBin`): `batches` of segments are counted and
 * written, a list started when a count reaches a multiple of `FORWARD_TILE_PRIMS`. A list holds its segments, its first write index and its count.
 */
interface ModelList {
  prims: number[]
  firstWrite: number
  count: number
}

/** Counts and writes `batches` (sizes of at most 1024) of segments into the lists of one tile; the lists, in the order they were started. */
export function binTile(batches: readonly number[]) {
  const lists: ModelList[] = []
  let counted = 0
  let written = 0
  let current = -1
  let previous = -1
  let next = 0
  for (const size of batches) {
    const oldCount = counted
    counted += size
    // The tile whose count reaches the start of a list is given one; the list that was being filled is full.
    const crossing =
      Math.floor((counted - 1) / FORWARD_TILE_PRIMS) >
        Math.floor((oldCount - 1) / FORWARD_TILE_PRIMS) || oldCount === 0
    if (crossing && size > 0) {
      lists.push({ prims: [], firstWrite: (counted - 1) & ~(FORWARD_TILE_PRIMS - 1), count: 0 })
      if (written > 0) lists[current]!.count = FORWARD_TILE_PRIMS
      previous = current
      current = next++
    }
    for (let k = 0; k < size; k++) {
      const old = written++
      const toCurrent = old >= lists[current]!.firstWrite
      const list = lists[toCurrent ? current : previous]!
      list.prims[old % FORWARD_TILE_PRIMS] = old
      if (toCurrent && old + 1 === counted) list.count = (old % FORWARD_TILE_PRIMS) + 1
    }
  }
  return lists
}

/** The tiles a segment from `start` to `finish` (in tiles) walks, in order, as the WGSL walk steps (`forwardWalk`). */
export function walkTiles(start: readonly [number, number], finish: readonly [number, number]) {
  const far = 1e30
  const d = [finish[0] - start[0], finish[1] - start[1]]
  const len = Math.hypot(d[0]!, d[1]!)
  const dir = len > 1e-12 ? [d[0]! / len, d[1]! / len] : [1, 0]
  const moves = dir.map((c) => Math.abs(c) > 1e-9)
  const coord = [Math.floor(start[0]), Math.floor(start[1])]
  const step = dir.map((c, a) => (moves[a] ? Math.sign(c) : 0))
  const delta = dir.map((c, a) => (moves[a] ? Math.abs(1 / c) : far))
  const side = dir.map((c, a) =>
    moves[a] ? (coord[a]! - start[a]! + Math.max(step[a]!, 0)) / c : far,
  )
  const end = [Math.floor(finish[0]), Math.floor(finish[1])]
  const tiles: [number, number][] = []
  for (let it = 0; it < FORWARD_WALK_STEPS; it++) {
    tiles.push([coord[0]!, coord[1]!])
    if (coord[0] === end[0] && coord[1] === end[1]) break
    if (side[0]! < side[1]!) {
      side[0]! += delta[0]!
      coord[0]! += step[0]!
    } else {
      side[1]! += delta[1]!
      coord[1]! += step[1]!
    }
  }
  return tiles
}
