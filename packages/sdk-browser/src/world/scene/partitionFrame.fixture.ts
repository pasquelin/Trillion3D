// What the proofs of the partition frame share: cells that record what a frame hands them, a
// streamer that records what it is asked, an engine whose cut packs no world DAG.
import type { Engine } from '../../engine/types.ts'
import type { PartitionCells } from '../../partition/cells.ts'
import type { PageStreaming } from '../../streaming/pageStreamer.ts'

export type Io = Parameters<PartitionCells['frame']>[1]
/** No arrival budget: what a test places never depends on the time the machine takes. */
export const budget = { admits: () => true, spend() {} }
/** An engine stand-in whose cut packs no world DAG. */
export const packsNoWorld = () => ({ worldCells: () => undefined }) as unknown as Engine

/** Cells that record what a frame hands them, and ask for one cell. */
export function recording() {
  const seen: { eye: number[]; io: Io }[] = []
  const closed: PartitionCells[] = []
  const cells = {
    frame(eye: number[], io: Io) {
      seen.push({ eye: [...eye], io })
      io.request(['near.json'])
    },
    decodes: () => [],
    reads: () => [],
    close: () => void closed.push(cells),
  } as unknown as PartitionCells
  return { cells, seen, closed }
}

/** A streamer that holds `files` by name, and records what it is asked. */
export function streamer(files: ReadonlyMap<string, Uint8Array> = new Map()) {
  const asked: [readonly string[], number][] = []
  const port = {
    readBytes: async (url: string, _signal: AbortSignal, priority: number) =>
      void asked.push([[url], priority]),
    getBytes: (url: string) => files.get(url.split('/').at(-1)!),
    failed: () => false,
    pin() {},
    unpin() {},
    admit() {},
    forget() {},
  } as unknown as PageStreaming
  return { port, asked }
}
