import type { PreparedBinary } from './accessors.ts'
/**
 * The images the prepared scene's textures sample, read from where the scene tables say they are —
 * an address beside the published document, or a view of its binary — and decoded the way the host
 * loader decoded them: an `ImageBitmap` with neither premultiplication nor colour conversion
 * (`decodeRaw`), the engine's one decoder.
 *
 * An image whose whole mip chain the cache baked is not read, whether it lives at an address or in
 * the binary: a one-pixel placeholder stands in its place, and the engine reads the baked levels
 * instead (`../../../materials/texture/skip.ts`). An image that
 * cannot be read or decoded is no image — its textures are left empty — as the loader left them.
 * A read the network or the server refused is asked again once the longest wait of the HTTP loader
 * has passed (`RETRY_AFTER_CAP_MS`); a file that cannot be decoded stays no image.
 */
import type { TableDocument } from '../../../../../sdk-core/src/scene/core/tableDocuments.ts'
import { BAKED_IMAGE } from '../../../../../sdk-core/src/contracts/compilerAbi.ts'
import { decodeRaw, fetchDecoded } from '../../../materials/texture/decode.ts'
import type { ByteMeter } from '../../../geometry/cluster/byteMeter.ts'
import { log } from '../../../diagnostic/log.ts'
import { EngineError } from '../../../../../sdk-core/src/contracts/cache.ts'
import { retriableError } from '../../../geometry/cluster/checked.ts'
import { RETRY_AFTER_CAP_MS } from '../../../geometry/cluster/retryCap.ts'
import { cpuNow, msSince } from '../../../diagnostic/stopwatch.ts'

/** A failed read of the document's binary, told apart from an image that cannot be decoded. */
class UnreadBinary extends Error {
  constructor(cause: unknown) {
    super('the scene binary could not be read', { cause })
  }
}

const decodeBytes = (bytes: Uint8Array<ArrayBuffer>, type: string) =>
  decodeRaw(new Blob([bytes], { type }))

type Inputs = {
  document: TableDocument
  /** Address of the published document: relative image addresses resolve against it. */
  documentUrl: string
  /** Reads a range of the document's binary, which embedded images are views of. */
  binary: PreparedBinary
  /** Ranks of the images whose chain the cache baked. */
  skipped: ReadonlySet<number>
  signal: AbortSignal | undefined
  /** Wraps each read the way the session counts resources for its progress. */
  track: <T>(resource: string, read: Promise<T>) => Promise<T>
  /** Counts the bytes of each image read as they arrive. */
  meter: ByteMeter
}

/**
 * The decoded image of each rank of the document, read on first request — only the images a worn
 * surface samples cross the network — or `null` when it could not be read.
 */
export function preparedImages(inputs: Inputs) {
  const { document, documentUrl, binary, skipped, signal, track, meter } = inputs
  const read = async (rank: number): Promise<unknown> => {
    if (skipped.has(rank)) return track(BAKED_IMAGE, fetchDecoded(BAKED_IMAGE, signal, meter))
    const image = document.images[rank]
    if (image.uri !== null) {
      const url = new URL(image.uri, documentUrl).href
      return track(url, fetchDecoded(url, signal, meter))
    }
    if (image.view === null) throw new Error(`image ${rank} names no source`)
    const view = document.views[image.view]
    // A binary that cannot be read fails its reader, as the loader failed the scene: it is no
    // missing image, and it is read again at the next need (`readOnce`).
    const buffer = await binary.range(view.offset, view.length).catch((error: unknown) => {
      throw new UnreadBinary(error)
    })
    return decodeBytes(new Uint8Array(buffer), image.mimeType ?? '')
  }
  const held = new Map<number, Promise<unknown>>()
  /** When each image whose read was refused for a reason that may pass was given up, on the CPU clock. */
  const refusedAt = new Map<number, number>()
  return (rank: number): Promise<unknown> => {
    const since = refusedAt.get(rank)
    if (since !== undefined && msSince(since) >= RETRY_AFTER_CAP_MS) {
      refusedAt.delete(rank)
      held.delete(rank)
    }
    let image = held.get(rank)
    if (!image) {
      image = read(rank).catch((error: unknown) => {
        if (error instanceof UnreadBinary) {
          held.delete(rank)
          throw error.cause
        }
        signal?.throwIfAborted()
        log.error('could not read image', rank, error)
        if (
          error instanceof EngineError &&
          error.code === 'RESOURCE_HTTP_ERROR' &&
          retriableError(error)
        )
          refusedAt.set(rank, cpuNow())
        return null
      })
      held.set(rank, image)
    }
    return image
  }
}
