// What the streaming holds of a STREAMING PAGE (`queue.ts`, `pageUnits.ts`): the pages it depends
// on held for it, its desired pages taken on, everything let go at once, and the pages of it the
// pool still holds.
import type { GpuPageCache } from '../pages/pool/pages.ts'
import type { QueueState } from './queueState.ts'

/** The streaming pages `dependOn` found, one scratch the one call at a time fills and empties. */
const held = new Set<number>()

/** `by` more started or resident streaming pages depend on each streaming page holding a parent
 *  of a page of `unit` (fewer when negative), `unit` itself apart: one read off the structure, the
 *  same each time. */
export function dependOn(s: QueueState, unit: number, by: number) {
  const { parentsOf, tracking, sets } = s.o,
    { units } = tracking
  held.clear()
  for (const page of units.records(unit))
    for (const parent of parentsOf(page)) held.add(units.of(tracking.keyOf(parent)))
  held.delete(unit)
  for (const parent of held) sets.streamed.depend(parent, by)
}

/** The desired pages of `unit` — those the cut asks for (`sets.requests`), and `asked`, the page
 *  that requested it — taken on by the pool. */
export function takeDesired(s: QueueState, unit: number, asked?: number) {
  const { sets, tracking } = s.o,
    { units } = tracking
  const keys = units.keys(unit),
    pages = units.records(unit)
  for (let i = 0; i < keys.length; i++)
    if (keys[i] === asked || sets.requests(keys[i])) sets.take(keys[i], pages[i])
}

/** `unit` let go by the streaming: out of its use order, the streaming pages it depends on held
 *  one less, its pages out of what the pool took on. Returns its record; none for a streaming page
 *  it did not hold. */
export function letGo(s: QueueState, unit: number) {
  const { sets, tracking } = s.o
  const page = sets.streamed.drop(unit)
  if (!page) return undefined
  dependOn(s, unit, -1)
  for (const key of tracking.units.keys(unit)) sets.drop(key)
  return page
}

/** The address of a page of `unit` that `cache` holds, none when it holds none: the slot a victim
 *  gives up is named by it (`../pages/pool/load.ts`). */
export function residentAddress(s: QueueState, cache: GpuPageCache, unit: number) {
  const { pageCatalog, units } = s.o.tracking
  for (const key of units.keys(unit)) if (cache.holds(pageCatalog[key])) return pageCatalog[key]
  return undefined
}

/** The pages of `unit` that `cache` still holds, unloaded: a streaming page the streaming let go
 *  without an arrival taking its slot gives the slot back whole (`../pages/pool/placement.ts`). */
export function unloadStranded(s: QueueState, cache: GpuPageCache, unit: number) {
  const { pageCatalog, units } = s.o.tracking
  for (const key of units.keys(unit))
    if (cache.holds(pageCatalog[key])) cache.unload(pageCatalog[key])
}
