/**
 * THE SHADOW CHANGES STALE THE PREVIOUS FRAME'S PAGES (`castStale.ts`), in one pass over one list:
 * the records the passes appended (`../webgpu/shadow/castChanges.ts`), never read by the CPU, and
 * the CPU's boxes of what no row says (`castBoxes.ts`), appended to it by the stale. The CPU sends
 * the maps that may hold cached pages, read before the plan gives this frame its ids
 * (`vsmCastMaps`), and its boxes; a one-thread kernel sizes the stale's dispatch from the list's
 * count. Once read, the list is emptied in the same command buffer.
 */
import { consumedCasts, reserveCasts, type CastChanges } from '../webgpu/shadow/castChanges.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import type { VsmCastBoxes } from './castBoxes.ts'
import { vsmMapWord } from './staleMapWgsl.ts'
import { encodeCastStale } from './castStale.ts'
import type { VsmResources } from './resources.ts'

/** The words `vsmCastMaps` writes, rewritten each plan and read by the frame that made them. */
let mapWords = new Uint32Array(16)

/** The maps that may hold cached pages, each a word (`vsmMapWord`), ids the previous frame's. None
 *  when the cache holds nothing to stale, or when nothing changed: neither the CPU's `boxes` nor a
 *  pass appended to the list `casts` since it was last read. */
export function vsmCastMaps(
  cache: VsmCacheManager,
  boxes: VsmCastBoxes | null,
  casts: CastChanges | undefined,
): Uint32Array | null {
  if (!cache.acceptsInvalidations() || !(boxes || casts?.appended)) return null
  let count = 0
  for (const entry of cache.entries.values()) {
    if (!entry.mayHoldCachedPages()) continue
    mapWords = resized(mapWords, count + entry.mapCaches.length)
    for (let i = 0; i < entry.mapCaches.length; i++) mapWords[count++] = vsmMapWord(entry, i)
  }
  return count ? mapWords.subarray(0, count) : null
}

/** What the frame stales: the previous frame's map slot count, its maps (`vsmCastMaps`), the
 *  CPU's boxes (`vsmCastBoxes`), the list, and the table's caster rows, which bound the list. */
interface VsmCastFrame {
  device: GPUDevice
  mapSlotCount: number
  maps: Uint32Array | null
  boxes: VsmCastBoxes | null
  casts: CastChanges
  rows: number
}

/**
 * Stales the pages the shadow changes touched in the previous frame's maps, into `encoder`: the
 * CPU's `boxes` appended to the list `casts`, room made for them, then the list read and emptied.
 * Nothing when neither changed; nothing staled when the previous frame had no slot or no map may
 * hold cached pages, the list emptied all the same — no page holds what it names. Must run before
 * the page carry. Returns the threads the CPU's boxes take, the CPU's part of the dispatch the GPU
 * sizes.
 */
export function encodeCastInvalidation(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmCastFrame,
) {
  const { device, mapSlotCount, maps, boxes, casts } = frame
  const boxCount = boxes?.count ?? 0
  if (!casts.appended && !boxCount) return 0
  let threads = 0
  if (mapSlotCount > 0 && maps) {
    // A pass encoded into `encoder` before may name the list: a growth copies into it after.
    if (boxCount) reserveCasts(casts, device, boxCount, frame.rows, encoder)
    encodeCastStale(encoder, res, device, { maps, boxes, list: casts.buffer })
    threads = boxCount * maps.length
  }
  if (casts.appended) consumedCasts(casts, encoder)
  return threads
}
