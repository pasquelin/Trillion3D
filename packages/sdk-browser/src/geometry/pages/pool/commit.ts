import { msSince } from '../../../diagnostic/stopwatch.ts'
import type { GpuPageContext, ResidentPage } from './types.ts'
import type { Place } from './placement.ts'
import { alignDown, alignUp } from '../../../../../math/src/scalar/integers.ts'
import { isGeometryPage } from '../install/installer.ts'

/** A page's last 1-3 bytes, zero-padded to the word `writeBuffer` requires; it copies them at once. */
const tail = new Uint8Array(4)

/** A page leaves residency: the change log and the sample both say so, wherever the
 *  departure came from. The slot is not returned here — the caller knows what it does with it.
 *  A page of it still staged is installed first: the page that takes its slot is staged after it,
 *  and one dispatch of the install passes writes the two in no order. */
export function evictResident(
  context: GpuPageContext,
  page: ResidentPage,
  reason: 'capacity' | 'explicit-unload' | 'resize',
) {
  const { resident, state } = context
  context.install.flushAt(page.offset)
  resident.delete(page.key)
  if (context.eviction.isPinned(page.key)) context.changes.unpinned(page.key)
  context.eviction.left(page.key)
  context.changes.left(page.key)
  state.evictions++
  context.reader.emit?.('gpu-page-eviction', 'Page removed from GPU residency', () => ({
    version: 1,
    key: page.key,
    offset: page.offset,
    generation: page.generation,
    bytes: page.bytes,
    reason,
    drawDetached: false,
  }))
}

/** `bytes` written into the pool at `offset`: a geometry page on disk staged for the install
 *  passes, any other page as it is. */
function writePage(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  { offset, start }: Place,
  dependencies: readonly string[],
) {
  const { device, buffer } = context
  // A page lies in its streaming page's slot at its offset there (`placement.ts`). Writing more
  // would charge every page a clear, a copy and a transfer of bytes nothing reads: a page-table
  // row names its offset and triangle count, and the visibility pass does not leave that range.
  // Only the page's bytes go, padded to the multiple of four that `writeBuffer` requires — every
  // page of a streaming page starts on a word. Its whole words go straight from its own bytes —
  // `writeBuffer` copies them itself, a staging copy first would only double the copy —
  // and only its last 1-3 bytes, zero-padded to a word, through the four-byte `tail`.
  const size = bytes.byteLength,
    body = alignDown(size, 4)
  if (isGeometryPage(bytes)) {
    context.install.add({
      bytes,
      offset,
      room: context.placement.room(key),
      unit: start,
      dependencies: () => dependencies.map((page) => context.placement.startOf(page)),
    })
    return
  }
  if (body > 0) device.queue.writeBuffer(buffer, offset, bytes as Uint8Array<ArrayBuffer>, 0, body)
  if (alignUp(size, 4) !== body) {
    tail.fill(0)
    tail.set(bytes.subarray(body))
    device.queue.writeBuffer(buffer, offset + body, tail, 0, 4)
  }
}

/** The upload and the end of the load of `page`, told to who listens. */
function reportArrival(
  context: GpuPageContext,
  page: ResidentPage,
  padded: number,
  uploadDurationMs: number | null,
  requestStarted: number,
) {
  const { emit, report } = context.reader
  const { key, offset, bytes } = page
  emit?.('gpu-page-upload', 'Page written into a GPU slot', () => ({
    version: 1,
    key,
    offset,
    generation: page.generation,
    actualDataBytes: bytes,
    uploadedBytes: padded,
    uploadDurationMs,
    gpuMs: null,
    drawDetached: false,
  }))
  emit?.('gpu-page-load-end', 'GPU load finished', () => ({
    version: 1,
    key,
    offset,
    generation: page.generation,
    actualDataBytes: bytes,
    uploadedBytes: padded,
    durationMs: report ? msSince(requestStarted) : null,
  }))
}

/** Installs `key`'s bytes at `place`, its victim already gone (`placement.ts`), and records the
 *  arrival: a geometry page on disk is staged for the install passes, which write the resident page
 *  at its offset (`../install/installer.ts`), finding the clusters it names vertices of in the
 *  streaming pages `dependencies` name (one page of each, in the order of its list; one not
 *  resident gives none); any other page is written as it is. */
export function commitGpuPage(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  place: Place,
  requestStarted: number,
  dependencies: readonly string[] = [],
): ResidentPage {
  const { state, resident, reader } = context
  state.bytesRead += bytes.byteLength
  const uploadStarted = reader.now()
  writePage(context, key, bytes, place, dependencies)
  const uploadDurationMs = reader.report ? msSince(uploadStarted) : null
  const padded = alignUp(bytes.byteLength, 4)
  state.uploadedBytes += padded
  const page = {
    key,
    offset: place.offset,
    bytes: bytes.byteLength,
    generation: ++state.generation,
  }
  resident.set(key, page)
  context.changes.placed(key, place.offset)
  context.changes.arrived(key)
  reportArrival(context, page, padded, uploadDurationMs, requestStarted)
  return page
}
