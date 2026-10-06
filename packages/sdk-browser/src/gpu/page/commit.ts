import type { GpuPageContext, ResidentPage } from './types.ts'
import { heldHomes } from './homes.ts'

/** A page's last 1-3 bytes, zero-padded to the word `writeBuffer` requires; it copies them at once. */
const tail = new Uint8Array(4)

/** A page leaves residency: the change log and the sample both say so, wherever the
 *  departure came from. The slot is not returned here — the caller knows what it does with it. */
export function evictResident(
  context: GpuPageContext,
  page: ResidentPage,
  reason: 'capacity' | 'explicit-unload' | 'resize',
) {
  const { resident, pins, changeKeys, changeSlots, state } = context
  resident.delete(page.key)
  pins.delete(page.key)
  context.held.delete(page.key)
  context.eviction.lower.delete(page.key)
  changeKeys.push(page.key)
  changeSlots.push(-1)
  state.evictions++
  context.reader.emit?.('gpu-page-eviction', 'Page removed from GPU residency', () => ({
    version: 1,
    key: page.key,
    slot: page.slot,
    generation: page.generation,
    bytes: page.bytes,
    reason,
    drawDetached: false,
  }))
}

/** The order's next resident, unpinned page, each entry passed once: one pinned when passed waits
 *  in `held` for its unpin; one a lower tier touched since the last order (`touch`) goes in `late`,
 *  taken after every other (#483 rules 1 and 7). */
function orderedVictim({ eviction, resident, pins }: GpuPageContext) {
  const { order, epoch, lower, held, late } = eviction
  const free = (key: string) => (pins.has(key) ? undefined : resident.get(key))
  while (eviction.at < order!.count) {
    const key = order!.keyAt(eviction.at++)
    if (!resident.has(key)) continue
    if ((lower.get(key) ?? -2) >= epoch - 1) late.push(key)
    else if (pins.has(key)) held.push(key)
    else return resident.get(key)
  }
  let page: ResidentPage | undefined
  for (let i = 0; i < held.length && !page; i++) page = free(held[i])
  while (!page && eviction.lateAt < late.length) page = free(late[eviction.lateAt++])
  return page
}

/** The least recently loaded or touched unpinned page; everything pinned is stated in O(1). */
function leastRecentVictim({ resident, pins }: GpuPageContext) {
  if (pins.size < resident.size)
    for (const page of resident.values()) if (!pins.has(page.key)) return page
  return undefined
}

/** `key`'s home when the pool holds the whole catalogue (`homes.ts`), `undefined` in fixed slots;
 *  a key the catalogue does not name has no place there, and is refused by name. */
export function homeOf(context: GpuPageContext, key: string) {
  const homes = heldHomes(context.homes, context.slots)
  if (!homes) return undefined
  const home = homes.homes.get(key)
  if (!home) throw new Error('PAGE_HOME_MISSING')
  return home
}

/** Reserves a slot, evicts only an unpinned page, and uploads one complete fixed-size GPU slot. */
export function commitGpuPage(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  requestStarted: number,
): ResidentPage {
  const { state, free, resident, pins, slots, changeKeys, changeSlots } = context
  const { device, buffer, pageBytes, reader } = context
  const { emit, now, report } = reader
  state.bytesRead += bytes.byteLength
  // A pool that holds the whole catalogue has a home for each page: no slot to choose, none to
  // take back; `free` counts the homes still empty.
  const home = homeOf(context, key)
  let slot = free.pop()
  if (home) slot = home.rank
  else if (slot === undefined) {
    const ordered = !!context.eviction.order
    const victim = ordered ? orderedVictim(context) : leastRecentVictim(context)
    if (!victim) {
      emit?.('gpu-page-admission-blocked', 'No evictable GPU slot', () => ({
        version: 1,
        key,
        reason: ordered ? 'eviction-queue-spent' : 'all-pages-pinned',
        resident: resident.size,
        slots,
        pinned: pins.size,
      }))
      throw new Error('ALL_PAGES_PINNED')
    }
    evictResident(context, victim, 'capacity')
    slot = victim.slot
  }
  const uploadStarted = now(),
    offset = home ? home.offset : slot * pageBytes
  // A slot is the size of the scene's LARGEST cluster. Writing the whole slot would charge every
  // page — even a tiny one — a clear, a copy and a transfer of that size, while nothing ever
  // reads the slot's tail: a page-table row names its offset and triangle count, and the
  // visibility pass does not leave that range. Only the page's bytes go, padded to the multiple
  // of four that `writeBuffer` requires. The page's whole words go straight from its own bytes —
  // `writeBuffer` copies them itself, a staging copy first would only double the copy (#982) —
  // and only its last 1-3 bytes, zero-padded to a word, through the four-byte `tail`.
  const size = bytes.byteLength,
    body = size & ~3,
    padded = (size + 3) & ~3
  if (body > 0) device.queue.writeBuffer(buffer, offset, bytes as Uint8Array<ArrayBuffer>, 0, body)
  if (padded !== body) {
    tail.fill(0)
    tail.set(bytes.subarray(body))
    device.queue.writeBuffer(buffer, offset + body, tail, 0, 4)
  }
  const uploadDurationMs = report ? performance.now() - uploadStarted : null
  state.uploadedBytes += padded
  const page = {
    key,
    slot,
    offset,
    bytes: bytes.byteLength,
    generation: ++state.generation,
  }
  resident.set(key, page)
  changeKeys.push(key)
  changeSlots.push(page.offset / 4)
  emit?.('gpu-page-upload', 'Page written into a GPU slot', () => ({
    version: 1,
    key,
    slot,
    offset,
    generation: page.generation,
    actualDataBytes: bytes.byteLength,
    uploadedBytes: padded,
    uploadDurationMs,
    gpuMs: null,
    drawDetached: false,
  }))
  emit?.('gpu-page-load-end', 'GPU load finished', () => ({
    version: 1,
    key,
    slot,
    generation: page.generation,
    actualDataBytes: bytes.byteLength,
    uploadedBytes: padded,
    durationMs: report ? performance.now() - requestStarted : null,
  }))
  return page
}
