// Where a page's load lands: its home's room, its place and the victim it evicts, the places a
// load may take now, and the refusal said when none is left.
import type { GpuPageContext, ResidentPage } from './types.ts'
import { evictResident } from './commit.ts'
import { isGeometryPage } from '../install/installer.ts'

/** A raw page fills its streaming page's place from its offset at most (`placement.ts`, `room`):
 *  one past it would write over its neighbour. A geometry page on disk is no measure of its place:
 *  the pass writes the resident page it makes of it, the bytes the source's gate proved the
 *  manifest's (`frame/backend/readPage.ts`), and skips one that would pass the room its job gives
 *  (`../install/transcodeWgsl.ts`). */
export function checkRoom(context: GpuPageContext, key: string, bytes: Uint8Array) {
  if (isGeometryPage(bytes)) return
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

/** A geometry page names vertices of the clusters of the streaming pages it depends on
 *  (`dependencies`, one page of each): they must be resident when it is installed, else the load is
 *  refused as for want of a place — asked again once they are — before it takes one. A page of its own
 *  streaming page is no dependency: it arrives with it. */
export function checkDependencies(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  dependencies: readonly string[] | undefined,
) {
  if (!dependencies || !isGeometryPage(bytes)) return
  const absent = dependencies.find(
    (page) => !context.resident.has(page) && !context.placement.sameUnit(page, key),
  )
  if (absent !== undefined) throw refusal(context, key, `dependency-absent:${absent}`)
}

/** The place of `key`'s page, `victim` — a page the host gives up for it, still resident and
 *  unpinned — evicted with every page of its streaming page; refused by name when no slot is free
 *  nor given. */
export function placeOf(context: GpuPageContext, key: string, victim: ResidentPage | undefined) {
  const place = context.placement.place(key, victim)
  if (typeof place === 'string') throw refusal(context, key, place)
  for (const page of place.victims) evictResident(context, page, 'capacity')
  return place
}

/** The places a load may take now without a victim: the free ones of `key`'s kind — root grains
 *  for one of the root cover (`placement.ts`) —, or for `key` whose streaming page holds a place
 *  already, that one. */
export const placesFor = (context: GpuPageContext, key?: string) =>
  key !== undefined && context.placement.holds(key) ? 1 : context.placement.freeFor(key)

/** `key` refused for lack of a place, and said. */
export function refusal(context: GpuPageContext, key: string, reason: string) {
  const { resident, slots, eviction } = context
  context.reader.emit?.('gpu-page-admission-blocked', 'No free GPU slot', () => ({
    version: 1,
    key,
    reason,
    resident: resident.size,
    slots,
    pinned: eviction.pinnedCount,
  }))
  return new Error('POOL_FULL')
}
