import type { SharedShapes } from '../sharedShapes.ts'
import type { Placed, TileShape } from './tilePlace.ts'

const farFirst = (a: { near: number }, b: { near: number }) => b.near - a.near

/** The lists the tiles keep from one update to the next, and their counts (`createTileKeeps`). */
type Keeps = {
  keeping: TileShape[]
  kept: TileShape[]
  count: number
  orders: number
  next: number
  ordered: boolean
  /** The bodies let in, farthest first, `orders` of them, taken from `next` on. */
  order: Placed[]
  /** The placements let in waiting for a body on a restored tile. */
  ready: Placed[]
}

/** Keeps the tiles of `placed[0, n)`, let in by update `pass`, each unrestored one with the
 *  placements of it waiting; lets go of the last update's: the placements `ready`, counted. */
function keepTiles(
  k: Keeps,
  shapes: SharedShapes,
  placed: readonly Placed[],
  n: number,
  pass: number,
) {
  const { keeping, kept, ready } = k
  let tiles = 0,
    waiting = 0
  for (let i = 0; i < n; i++) {
    const p = placed[i],
      shape = p.shape
    if (shape.kept !== pass) {
      shape.kept = pass
      shape.waits = 0
      shapes.use(shape)
      keeping[tiles++] = shape
    }
    if (shape.handle < 0) shape.waiting[shape.waits++] = p
    else if (p.id < 0) ready[waiting++] = p
  }
  for (let i = 0; i < k.count; i++) shapes.done(kept[i])
  k.kept = keeping
  k.keeping = kept
  k.count = tiles
  k.ordered = false
  return waiting
}

/** Evicts the farthest body of `placed[0, n)`, the placements the last update let in: their
 *  bodies ordered once, at the first eviction, each next one O(1). */
function evictNext(k: Keeps, evict: (p: Placed) => void, placed: readonly Placed[], n: number) {
  const { order } = k
  if (!k.ordered) {
    k.orders = k.next = 0
    for (let i = 0; i < n; i++) if (placed[i].id >= 0) order[k.orders++] = placed[i]
    order.length = k.orders
    order.sort(farFirst)
    k.ordered = true
  }
  while (k.next < k.orders) {
    const p = order[k.next++]
    if (p.id >= 0) return evict(p)
  }
}

/** Lets the farthest restored tiles of `tiles` — nearest first — update `pass` kept go until
 *  `needed` bytes more are free: their uses given back. */
function giveBackFarthest(
  k: Keeps,
  shapes: SharedShapes,
  tiles: TileShape[],
  pass: number,
  needed: number,
) {
  const { kept } = k
  for (let i = tiles.length - 1; i >= 0 && needed > 0; i--) {
    const shape = tiles[i]
    if (shape.kept !== pass || shape.handle < 0) continue
    shape.kept = -1
    needed -= shape.bytes
    for (let j = 0; j < k.count; j++)
      if (kept[j] === shape) {
        kept[j] = kept[--k.count]
        shapes.done(shape)
        break
      }
  }
}

/** Cuts every list to what is held: the tiles no one holds let go of. */
function trimKeeps(k: Keeps, shapes: SharedShapes) {
  const { kept } = k
  let tiles = 0
  for (let i = 0; i < k.count; i++)
    if (kept[i].holders) kept[tiles++] = kept[i]
    else shapes.done(kept[i])
  kept.length = k.count = tiles
  k.keeping.length = k.ready.length = k.order.length = k.orders = k.next = 0
  k.ordered = false
}

/**
 * What the tiles hold from one update to the next: each tile a placement of which an update lets
 * in, kept restored by one use (`SharedShapes.use`) taken before the last update's are let go of,
 * with the placements let in that wait for its restore (`TileShape.waiting`); the placements let
 * in that wait for a body on a restored tile (`ready`); and the bodies of the placements let in,
 * the farthest leaving first for a body that needs a slot. Every list is written over with its
 * count; `trim` cuts their tails once a model leaves.
 */
export function createTileKeeps(shapes: SharedShapes, evict: (p: Placed) => void) {
  const k: Keeps = {
    ...{ keeping: [], kept: [], count: 0, orders: 0, next: 0, ordered: false },
    ...{ order: [], ready: [] },
  }
  return {
    ready: k.ready,
    keep: (placed: readonly Placed[], n: number, pass: number) =>
      keepTiles(k, shapes, placed, n, pass),
    /** Bodies built since the order was taken: the next eviction takes it again. */
    unorder: () => void (k.ordered = false),
    evictFarthest: (placed: readonly Placed[], n: number) => evictNext(k, evict, placed, n),
    /**
     * Lets the farthest restored tiles of `tiles` — nearest first — update `pass` kept go until
     * `needed` bytes more are free, every body of them among `placed[0, n)`, the placements it let
     * in: their uses given back and the shapes released (`settle`). O(U + n), a rare path.
     */
    letGoFarthest(
      tiles: TileShape[],
      placed: readonly Placed[],
      n: number,
      pass: number,
      needed: number,
    ) {
      giveBackFarthest(k, shapes, tiles, pass, needed)
      for (let i = 0; i < n; i++) if (placed[i].shape.kept !== pass) evict(placed[i])
      shapes.settle()
    },
    /** The tiles and placements its lists name, tails included. */
    listed: () => k.kept.length + k.keeping.length + k.ready.length + k.order.length,
    trim: () => trimKeeps(k, shapes),
  }
}
