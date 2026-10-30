import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { keptOrMade } from '../../../gpu/core/keptOrMade.ts'
import {
  cacheTempBytes,
  cacheTempExtent,
  cacheTraceBytes,
  sameShape,
  type CacheTemp,
} from './cacheLayout.ts'
import {
  createCacheTemp,
  createTraceAtlas,
  type CacheStorage,
  type CacheTempStorage,
  type TraceAtlas,
} from './cacheStorage.ts'

/** What the radiance cache keeps of the atlases of a frame between two images. */
export interface FrameAtlases {
  readonly device: GPUDevice
  /** The atlases of the frame, laid out for the queue's block of probes (`cacheTempExtent`), and the trace atlas of the rays cast through
   *  the scene's triangles: kept while the updates ask no larger a size, nor a size under `SHRINK_AFTER_UPDATES` updates of a quarter of
   *  theirs, else replaced. */
  temp: CacheTempStorage | undefined
  traceAtlas: TraceAtlas | undefined
  /** The updates in a row that asked at most a quarter of the texels of each atlas held (`lingers`). */
  smallTemp: number
  smallTrace: number
}

/** The trace atlas given back: destroyed once the image that names it is submitted. */
export function dropTraceAtlas(state: FrameAtlases) {
  if (state.traceAtlas) retire(state.device, state.traceAtlas)
  state.traceAtlas = undefined
  state.smallTrace = 0
}

/** The marked trace atlas given back where the hit lighting that asked it is off: a plain trace then makes its own, and the marks texture is not held for nothing. */
export function dropMarks(state: FrameAtlases) {
  if (state.traceAtlas?.marks) dropTraceAtlas(state)
}

/** The atlases of the frame given back: destroyed once the image that names them is submitted. */
export function dropTemp(state: FrameAtlases) {
  if (state.temp) retire(state.device, state.temp)
  state.temp = undefined
  state.smallTemp = 0
  dropTraceAtlas(state)
}

/**
 * The atlases of the frame for the queue's block of probes `queue`, the held ones where their extent holds the block (its row is a uniform)
 * and has not stayed a quarter of theirs for `SHRINK_AFTER_UPDATES` updates; else made at the size asked, where the device's budget leaves
 * room (`ledgerAdmitted`, the held ones' bytes credited) — none where it does not, and the update is not made.
 */
export function tempFor(state: FrameAtlases, storage: CacheStorage, queue: CacheTemp) {
  const held = state.temp
  const [width, height] = cacheTempExtent(storage.shape.resolution, queue)
  const { atlas, small } = keptOrMade(
    state.device,
    held,
    {
      holds:
        held !== undefined &&
        sameShape(held.shape, storage.shape) &&
        held.extent[0] >= width &&
        held.extent[1] >= height,
      small: state.smallTemp,
      asked: width * height,
      texels: held ? held.extent[0] * held.extent[1] : 0,
    },
    {
      asked: cacheTempBytes(storage.shape, queue),
      what: 'the radiance cache’s atlases of a frame',
      make: () => createCacheTemp(state.device, storage.shape, queue),
    },
  )
  state.smallTemp = small
  return (state.temp = atlas)
}

/** The trace atlas for `tiles` tiles, its rays' light stored in `light` (the atlases of a frame are given back whenever the cache's maps are made again, so the held one is of that format), the held one where it holds as many and has not stayed a quarter of them for `SHRINK_AFTER_UPDATES`
 *  updates; else made, where the device's budget leaves room — none where it does not, and the rays are marched. `marked` asks the texture the hits are marked in beside it (the hit lighting): a held atlas that has it serves a plain trace too (the marks unused, no atlas made again when the
 *  trace goes from lit to cards and back); a plain one held is replaced by a marked one only where the marked one is admitted, and kept where it is refused. */
export function traceAtlasFor(
  state: FrameAtlases,
  tiles: number,
  light: LightAtlasFormat,
  marked = false,
) {
  const held = state.traceAtlas
  // A marked atlas held serves a plain trace too; a plain one serves only a plain trace. A marks texture the budget refuses (or a shrink) keeps the atlas held, not dropping what works to make it again on the retry; a grow it refuses gives the held one back.
  const {
    atlas,
    held: now,
    small,
  } = keptOrMade(
    state.device,
    held,
    {
      holds: held !== undefined && held.tiles >= tiles && (!marked || held.marks !== undefined),
      small: state.smallTrace,
      asked: tiles,
      texels: held?.tiles ?? 0,
      // A swap of the same size class (plain <-> marked) or a shrink keeps the atlas held on a refusal; a grow does not: what is held cannot serve the ask.
      keepOnRefusal: held !== undefined && held.tiles >= tiles,
    },
    {
      asked: cacheTraceBytes(tiles, light, marked),
      what: 'the radiance cache’s trace atlas',
      make: () => createTraceAtlas(state.device, tiles, light, marked),
    },
  )
  state.smallTrace = small
  state.traceAtlas = now
  return atlas
}
