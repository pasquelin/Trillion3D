import type { GpuPageContext, ResidentPage } from './types.ts'
import type { Place } from './placement.ts'
import { alignDown, alignUp } from '../../../../math/src/scalar/integers.ts'

/** A page's last 1-3 bytes, zero-padded to the word `writeBuffer` requires; it copies them at once. */
const tail = new Uint8Array(4)

/** A page leaves residency: the change log and the sample both say so, wherever the
 *  departure came from. The slot is not returned here — the caller knows what it does with it. */
export function evictResident(
  context: GpuPageContext,
  page: ResidentPage,
  reason: 'capacity' | 'explicit-unload' | 'resize',
) {
  const { resident, pins, state } = context
  resident.delete(page.key)
  pins.delete(page.key)
  context.held.delete(page.key)
  context.eviction.left(page.key)
  context.changes.left(page.key)
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

/** Uploads `key`'s bytes at `place`, its victim already gone (`placement.ts`), and records the
 *  arrival. */
export function commitGpuPage(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  { slot, offset }: Place,
  requestStarted: number,
): ResidentPage {
  const { state, resident, device, buffer, reader } = context
  const { emit, now, report } = reader
  state.bytesRead += bytes.byteLength
  const uploadStarted = now()
  // A slot is the size of the scene's LARGEST cluster. Writing the whole slot would charge every
  // page — even a tiny one — a clear, a copy and a transfer of that size, while nothing ever
  // reads the slot's tail: a page-table row names its offset and triangle count, and the
  // visibility pass does not leave that range. Only the page's bytes go, padded to the multiple
  // of four that `writeBuffer` requires. The page's whole words go straight from its own bytes —
  // `writeBuffer` copies them itself, a staging copy first would only double the copy —
  // and only its last 1-3 bytes, zero-padded to a word, through the four-byte `tail`.
  const size = bytes.byteLength,
    body = alignDown(size, 4),
    padded = alignUp(size, 4)
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
  context.eviction.arrived(page)
  context.changes.placed(key, offset)
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
