import { ledgerAdmitted } from '../../../gpu/core/deviceLedger.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
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

/** The updates in a row that ask at most a quarter of the texels of an atlas held before it is made again at the size asked. A memory
 *  housekeeping rule with no effect on the image: the atlases of a frame only grow with the queue's block, and a full update, which asks
 *  the whole pool, would otherwise leave its size held for good. */
const SHRINK_AFTER_UPDATES = 30

/** The share of the texels held that an update must ask at most, to count toward the atlas being made again smaller. */
const SHRINK_SHARE = 1 / 4

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

/** The atlases of the frame given back: destroyed once the image that names them is submitted. */
export function dropTemp(state: FrameAtlases) {
  if (state.temp) retire(state.device, state.temp)
  state.temp = undefined
  state.smallTemp = 0
  dropTraceAtlas(state)
}

/**
 * The updates in a row that asked at most a quarter of the `held` texels, `small` before this one, `asked` texels now: the count after
 * it (none where this update asked more), and whether it has reached `SHRINK_AFTER_UPDATES`, the atlas then made again at the size asked.
 */
function lingers(small: number, asked: number, held: number) {
  const count = asked <= held * SHRINK_SHARE ? small + 1 : 0
  return { count, shrink: count >= SHRINK_AFTER_UPDATES }
}

/**
 * An atlas of the frame kept or made: the `held` one where it `holds` what is asked and the updates in a row that asked at most a quarter of its `texels` (`small` before this
 * one, `asked` texels now) have not reached `SHRINK_AFTER_UPDATES`, with the count after this update; else made at the size `admit` asks, where the device's budget leaves
 * room (`ledgerAdmitted`, the held one's bytes credited) — none where it does not — and the count none.
 */
function keptOrMade<T extends { bytes: number; destroy(): void }>(
  device: GPUDevice,
  held: T | undefined,
  keep: { holds: boolean; small: number; asked: number; texels: number },
  admit: { asked: number; what: string; make: () => T },
) {
  if (held && keep.holds) {
    const { count, shrink } = lingers(keep.small, keep.asked, keep.texels)
    if (!shrink) return { atlas: held, small: count }
  }
  const { value } = ledgerAdmitted(device, {
    held: held && { bytes: held.bytes, dispose: () => retire(device, held) },
    ...admit,
  })
  return { atlas: value, small: 0 }
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

/** The trace atlas for `tiles` tiles, the held one where it holds as many and has not stayed a quarter of them for `SHRINK_AFTER_UPDATES`
 *  updates; else made, where the device's budget leaves room — none where it does not, and the rays are marched. */
export function traceAtlasFor(state: FrameAtlases, tiles: number) {
  const held = state.traceAtlas
  const { atlas, small } = keptOrMade(
    state.device,
    held,
    {
      holds: held !== undefined && held.tiles >= tiles,
      small: state.smallTrace,
      asked: tiles,
      texels: held?.tiles ?? 0,
    },
    {
      asked: cacheTraceBytes(tiles),
      what: 'the radiance cache’s trace atlas',
      make: () => createTraceAtlas(state.device, tiles),
    },
  )
  state.smallTrace = small
  return (state.traceAtlas = atlas)
}
