/** What a partition's cells read and tell each frame and before the first (`cells.ts`), kept
 *  internal as the frame's budget is: the session's streamer, the decode pool, the catalogue, the
 *  engine's rows, the owner. */
import type { PlacementGrowth } from '../placement/backendSceneUpdates.ts'
import type { PlacementRows } from '../placement/rows.ts'
import type { StreamPage } from '../streaming/types.ts'
import type { CellRows } from './cellDecode.ts'
import type { PageBody } from './cellIndex.ts'

/** A frame's: the streamer's verified bytes and their decode off the main thread, reads and those
 *  refused for good, requests (`ahead`: before needed), catalogue, rows, else the owner told. */
export type CellFrameIo = {
  bytes(url: string): Uint8Array | undefined
  decode: (bytes: Uint8Array, url: string) => Promise<CellRows>
  decodePage: (bytes: Uint8Array, url: string) => Promise<PageBody>
  loading(url: string): boolean
  /** Whether a read of `url` is refused for good (`PageStreamer.failed`). */
  failed(url: string): boolean
  request(urls: readonly string[], ahead: boolean): void
  admit(pages: readonly StreamPage[]): void
  forget(urls: readonly string[]): void
  update(rows: PlacementRows, from: number, to: number): void
  grow?: PlacementGrowth
  outgrown?: () => void
  /** The cut's lens while it packs the world DAG, structurally a `SuperRootLens`. */
  lens?: {
    pixelScale: [number, number]
    pixelError: number
    near: number
    perspective?: number
    slope: number
  }
}

/** Before the first frame, as a frame's: the streamer's verified read, the decodes, the
 *  catalogue. */
export type CellPrimeIo = {
  read(url: string): Promise<Uint8Array>
  decode: (bytes: Uint8Array, url: string) => Promise<CellRows>
  decodePage: (bytes: Uint8Array, url: string) => Promise<PageBody>
  admit(pages: readonly StreamPage[]): void
}
