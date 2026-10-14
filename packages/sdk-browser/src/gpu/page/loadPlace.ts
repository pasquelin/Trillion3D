// Where a page's load lands: its home's room, its place and the victims it evicts, the places a
// load may take now, and the refusal said when none is left.
import type { GpuPageContext } from './types.ts'
import { evictResident } from './commit.ts'

/** A page fills its own home at most, where the pool holds the whole catalogue: one past it would
 *  write over its neighbour. */
export function checkRoom(context: GpuPageContext, key: string, bytes: Uint8Array) {
  const room = context.placement.room(key)
  if (bytes.byteLength <= room && bytes.byteLength !== 0) return
  const { emit } = context.reader
  emit?.('gpu-page-corruption', 'Unexpected GPU page size', () => ({
    version: 1,
    key,
    reason: 'page-size-mismatch',
    expectedBytes: room,
    actualBytes: bytes.byteLength,
  }))
  emit?.('gpu-page-admission-blocked', 'Page refused by a GPU slot capacity', () => ({
    version: 1,
    key,
    reason: 'page-size-mismatch',
    expectedBytes: room,
    actualBytes: bytes.byteLength,
  }))
  throw new Error('PAGE_SIZE_MISMATCH')
}

/** The place of `key`'s page of `bytes`, its victims evicted; refused by name when every slot is
 *  pinned or the published order is spent. A `prefetch` takes the place of an old page alone
 *  (`eviction.ts`): it never evicts one a view used of late. */
export function placeOf(context: GpuPageContext, key: string, bytes: number, prefetch: boolean) {
  const place = context.placement.slotFor(key, bytes, prefetch)
  if (typeof place === 'string') throw refusal(context, key, place)
  for (const victim of place.victims) evictResident(context, victim, 'capacity')
  return place
}

/** The places a load may take now: the free ones, and the pages the GPU's order still gives up — a
 *  prefetch, its old head alone (`eviction.ts`). */
export const placesFor = (context: GpuPageContext, prefetch = false) =>
  context.placement.free + context.eviction.victims(prefetch)

/** `key` refused for lack of a place, noted for the next order (`takeRefused`), and said. */
export function refusal(context: GpuPageContext, key: string, reason: string) {
  const { resident, slots, eviction, state } = context
  state.refused = true
  context.reader.emit?.('gpu-page-admission-blocked', 'No evictable GPU slot', () => ({
    version: 1,
    key,
    reason,
    resident: resident.size,
    slots,
    pinned: eviction.pinnedCount,
  }))
  return new Error('POOL_FULL')
}
