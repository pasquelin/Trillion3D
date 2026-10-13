import { createChangedRuns, type ChangedRuns } from '../residency/ranges.ts'

// The places of a tile pool (`pool.ts`): which key each holds, the free ones, the changed ones.

/** What a pool knows of its places: per place, the key it holds — -1 free —, whether it is pinned
 *  and the arrival it came with; the free places; the places changed since their use words were
 *  written. */
type Places = {
  tiles: number
  owner: Int32Array
  pinned: Uint8Array
  arrived: Uint32Array
  arrivals: number
  count: number
  /** Free places, the lowest on top of the stack: a half-empty pool stays compact. The stack is
   *  rebuilt in one pass when an adopt has stale-dated it, at the next take. */
  free: number[]
  freeStale: boolean
  changed: ChangedRuns
}

export const placesOf = (tiles: number): Places => ({
  tiles,
  owner: new Int32Array(tiles).fill(-1),
  pinned: new Uint8Array(tiles),
  arrived: new Uint32Array(tiles),
  arrivals: 0,
  count: 0,
  free: [],
  freeStale: true,
  changed: createChangedRuns(),
})

function settle(places: Places) {
  if (!places.freeStale) return
  const { free, owner } = places
  free.length = 0
  for (let index = places.tiles - 1; index >= 0; index--) if (owner[index] === -1) free.push(index)
  places.freeStale = false
}

/** `index`, held: a free place is refused. */
export function taken({ owner }: Places, index: number) {
  if (owner[index] === -1) throw new Error('TEXTURE_TILE_FREE')
  return index
}

function occupy(places: Places, index: number, key: number, pin: boolean) {
  places.owner[index] = key
  places.pinned[index] = pin ? 1 : 0
  places.arrived[index] = ++places.arrivals
  places.count++
  places.changed.mark(index)
}

export function acquire(places: Places, key: number, pin: boolean) {
  settle(places)
  const index = places.free.pop()
  if (index === undefined) return undefined
  occupy(places, index, key, pin)
  return index
}

export function adopt(places: Places, index: number, key: number, pin: boolean) {
  if (places.owner[index] !== -1) throw new Error('TEXTURE_TILE_OCCUPIED')
  occupy(places, index, key, pin)
  places.freeStale = true
}

export function release(places: Places, index: number) {
  taken(places, index)
  places.owner[index] = -1
  places.count--
  places.changed.mark(index)
  if (!places.freeStale) places.free.push(index)
}

export function occupied({ tiles, owner }: Places) {
  const out: number[] = []
  for (let index = 0; index < tiles; index++) if (owner[index] !== -1) out.push(index)
  return out
}
