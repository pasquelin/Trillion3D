/**
 * What a partition's frame reads of its session (`CellFrameIo`), and the run of frames a session's
 * open waits on (`primeFrames`): the cells within reach read, decoded and placed before the
 * engines read the rows (#575).
 */
import type { PlacementGrowth } from '../placement/engineSceneUpdates.ts'
import type { PlacementRows } from '../placement/rows.ts'
import type { StreamPage } from '../streaming/types.ts'
import type { CellRows } from './cellDecode.ts'
import type { PageBody } from './cellIndex.ts'
import type { CellFrame } from './follow.ts'

/** Kept internal as `budget` is: the streamer's verified bytes and their decode off the main
 *  thread, those refused for good, requests (`ahead`: before needed), catalogue, rows, else the
 *  owner told. */
export type CellFrameIo = {
  bytes(url: string): Uint8Array | undefined
  decode: (bytes: Uint8Array, url: string) => Promise<CellRows>
  decodePage: (bytes: Uint8Array, url: string) => Promise<PageBody>
  /** Whether a read of `url` is refused for good (`PageStreamer.failed`). */
  failed(url: string): boolean
  request(urls: readonly string[], ahead: boolean): void
  admit(pages: readonly StreamPage[]): void
  forget(urls: readonly string[]): void
  update(rows: PlacementRows, from: number, to: number): void
  grow?: PlacementGrowth
  /** The session's composition (`Engine.composePlacements`): rows linked to the scene's frame
   *  follow it on the GPU (`CellFrame`). */
  compose?: CellFrame['compose']
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

/** Structurally a `FrameBudget`, kept internal. */
export type CellBudget = { admits(): boolean; spend(): void }

/** Kept internal as a frame's: the streamer's verified read, the decodes, the catalogue. */
export type CellPrimeIo = {
  read(url: string): Promise<Uint8Array>
  decode: (bytes: Uint8Array, url: string) => Promise<CellRows>
  decodePage: (bytes: Uint8Array, url: string) => Promise<PageBody>
  admit(pages: readonly StreamPage[]): void
  forget(urls: readonly string[]): void
}

/** Runs `frame` from `eye` to completion on an unbounded budget, what it asks within reach read
 *  through `io.read` — a failure throws, the open fails —, nothing ahead, each round waiting on
 *  the reads and the `decodes` it asked; the bytes read. */
export async function primeFrames(
  eye: ArrayLike<number>,
  reach: number,
  io: CellPrimeIo,
  frame: (eye: ArrayLike<number>, reach: number, io: CellFrameIo, budget: CellBudget) => boolean,
  decodes: () => readonly Promise<unknown>[],
) {
  let bytes = 0
  const landed = new Map<string, Uint8Array>(),
    reads: Promise<void>[] = []
  const read = (url: string) =>
    io.read(url).then((got) => void ((bytes += got.byteLength), landed.set(url, got)))
  const port: CellFrameIo = {
    ...io,
    bytes: (url: string) => landed.get(url),
    failed: () => false,
    request(urls: readonly string[], ahead: boolean) {
      if (!ahead) for (const url of urls) if (!landed.has(url)) reads.push(read(url))
    },
    update() {},
  }
  for (;;) {
    const later = frame(eye, reach, port, { admits: () => true, spend() {} })
    const waits = [...reads.splice(0), ...decodes()]
    if (!later && !waits.length) break
    await Promise.all(waits)
  }
  return bytes
}
