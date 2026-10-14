/**
 * THE SHADOW CHANGES STALE THE PREVIOUS FRAME'S PAGES (`castInvalidationWgsl.ts`), in one pass: the
 * rows' — appended by the rows pass (`../webgpu/shadow/castChanges.ts`), never read by the CPU —
 * and the CPU's boxes of what no row says (`invalidationPhase.ts`). The CPU sends the maps that may
 * hold cached pages, read before the plan gives this frame its ids (`vsmCastMaps`), and its boxes;
 * a one-thread kernel sizes the stale's dispatch from the list's count. Once read, the list is
 * emptied in the same command buffer.
 */
import { consumedCasts, type CastChanges } from '../webgpu/shadow/castChanges.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import { VSM_CAST_BOX_BYTES } from './castInvalidationWgsl.ts'
import type { VsmInvalidationPhase } from './invalidationPhase.ts'
import { VSM_INVALIDATION_PARAMS_BYTES } from './invalidationWgsl.ts'
import { vsmMapWord } from './staleMapWgsl.ts'
import { castState, encodeCastStale, type VsmCastState } from './castStale.ts'
import { vsmEnsureBuffer, vsmRenderStorage } from './renderPass.ts'
import type { VsmResources } from './resources.ts'

/** The words `vsmCastMaps` writes, rewritten each plan and read by the frame that made them. */
let mapWords = new Uint32Array(16)

/** The maps that may hold cached pages, each a word (`vsmMapWord`), ids the previous frame's. None
 *  when the cache holds nothing to stale, or when nothing changed: neither the CPU's `boxes` nor a
 *  pass appended to the rows' list `casts` since it was last read. */
export function vsmCastMaps(
  cache: VsmCacheManager,
  boxes: VsmInvalidationPhase | null,
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

/** The parameters' words: the maps' count, the CPU's boxes' count, then padding. */
const paramsImage = new Uint32Array(VSM_INVALIDATION_PARAMS_BYTES / 4)

/** What the frame stales: the previous frame's map slot count, its maps (`vsmCastMaps`), the
 *  CPU's boxes (`vsmInvalidationPhaseFromShadowBoxes`) and the rows' list. */
interface VsmCastFrame {
  device: GPUDevice
  mapSlotCount: number
  maps: Uint32Array | null
  boxes: VsmInvalidationPhase | null
  casts?: CastChanges
}

/**
 * Stales the pages the shadow changes touched in the previous frame's maps, into `encoder`: the
 * rows' list `casts`, then emptied, and the CPU's `boxes`. Nothing when neither changed, nothing
 * staled when the previous frame had no slot or no map may hold cached pages, the list emptied all
 * the same — no page holds what it names. Must run before the page carry. Returns the threads the
 * CPU's boxes take, the CPU's part of the dispatch the GPU sizes.
 */
export function encodeCastInvalidation(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  held: { casts?: VsmCastState },
  frame: VsmCastFrame,
) {
  const { device, mapSlotCount, maps, boxes, casts } = frame
  const boxCount = boxes?.count ?? 0
  if (!casts?.appended && !boxCount) return 0
  let threads = 0
  if (mapSlotCount > 0 && maps) {
    const state = castState(device, res, held),
      label = 'vsm.castInvalidation'
    const storage = vsmRenderStorage()
    const mapBuffer = vsmEnsureBuffer(state, label, 'maps', maps.byteLength, storage),
      boxBuffer = vsmEnsureBuffer(
        state,
        label,
        'boxes',
        Math.max(1, boxCount) * VSM_CAST_BOX_BYTES,
        storage,
        VSM_CAST_BOX_BYTES,
      )
    // `vsmCastMaps`'s words, a view of its own buffer; the boxes, the phase's own scratch.
    device.queue.writeBuffer(mapBuffer, 0, maps as Uint32Array<ArrayBuffer>)
    if (boxes && boxCount)
      device.queue.writeBuffer(boxBuffer, 0, boxes.words, 0, (boxCount * VSM_CAST_BOX_BYTES) / 4)
    paramsImage[0] = maps.length
    paramsImage[1] = boxCount
    device.queue.writeBuffer(state.params, 0, paramsImage)
    // No list yet (no sphere buffer made): an empty one, its header zero as a buffer is made.
    const list = casts?.buffer ?? vsmEnsureBuffer(state, label, 'empty', 16, storage, 16)
    encodeCastStale(encoder, res, state, { list, maps: mapBuffer, boxes: boxBuffer })
    threads = boxCount * maps.length
  }
  if (casts?.appended) consumedCasts(casts, encoder)
  return threads
}
