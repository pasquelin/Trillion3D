import { NO_INDEX } from '../../../../math/src/constants.ts'
import { createChangedRuns, type ChangedRuns } from '../residency/ranges.ts'

// The places of a tile pool (`pool.ts`): which key each holds, the free ones, the changed ones.

/** What a pool knows of its places: per place, the key it holds — `NO_INDEX` free: no key reaches it, a tail's id sets the high bit, a tile's never does —, whether it is pinned
 *  and the arrival it came with; the free places; the places changed since their use words were
 *  written. */
type Places = {
  tiles: number
  /** Unsigned: a tail's id, its high bit set (`ids.ts`), is read back as the key it was given. */
  owner: Uint32Array
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
  owner: new Uint32Array(tiles).fill(NO_INDEX),
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
  for (let index = places.tiles - 1; index >= 0; index--)
    if (owner[index] === NO_INDEX) free.push(index)
  places.freeStale = false
}

/** Whether `index` is free. */
export const freeAt = ({ owner }: Places, index: number) => owner[index] === NO_INDEX

/** `index`, held: a free place is refused. */
export function taken(places: Places, index: number) {
  if (freeAt(places, index)) throw new Error('TEXTURE_TILE_FREE')
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
  if (!freeAt(places, index)) throw new Error('TEXTURE_TILE_OCCUPIED')
  occupy(places, index, key, pin)
  places.freeStale = true
}

/** `index` pinned or unpinned by an asker that may read no pixel of it (a card's maps,
 *  `cardTiles.ts`): pinned, unranked; unpinned, used as an arrival is — its use word written at the
 *  next flush's clock. Either way a queue cut before it never names it. */
export function pin(places: Places, index: number, pinned: boolean) {
  if (places.pinned[taken(places, index)] === Number(pinned)) return
  places.pinned[index] = Number(pinned)
  places.arrived[index] = ++places.arrivals
  places.changed.mark(index)
}

export function release(places: Places, index: number) {
  taken(places, index)
  places.owner[index] = NO_INDEX
  places.count--
  places.changed.mark(index)
  if (!places.freeStale) places.free.push(index)
}

export function occupied(places: Places) {
  const out: number[] = []
  for (let index = 0; index < places.tiles; index++) if (!freeAt(places, index)) out.push(index)
  return out
}
