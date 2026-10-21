import { appendTo } from '../../../../math/src/sequence/counts.ts'
import { createFrameKept } from '../streaming/frameKept.ts'
import type { CellBudget } from './cellsPrime.ts'

/**
 * THE FILES READ AND DECODED, WAITING FOR A FRAME TO TAKE THEM (#575): a cell file, or a page of
 * the cell index. Its verified bytes are handed to the page worker pool as soon as a frame needs them
 * (`cellDecode.ts`, `readCellPage`); a later frame places its rows, or opens the page, within the
 * one integration budget (`cells.ts`). Only what the frames still plan is kept, by the plan's one
 * rule (`../streaming/frameKept.ts`): the map follows the view, not the world.
 */
export function createDecodes<Key, Decoded extends object>() {
  /** Each file's decoded form, the decode under way, or why it was refused. */
  const decoded = createFrameKept<Key, Decoded | Promise<void> | { refused: unknown }>()
  let asked: Promise<void>[] = []
  return {
    /** `cell`'s decoded form, else `undefined`, kept by the frame under way: its bytes, once
     *  `bytes` reads them, are handed to `decode` first. A file the decode refused is thrown, as
     *  its frame reads it. */
    decoded(
      cell: Key,
      bytes: () => Uint8Array | undefined,
      decode: (bytes: Uint8Array) => Promise<Decoded>,
    ) {
      const own = decoded.touch(cell)
      if (own && 'refused' in own) throw own.refused
      if (own) return own instanceof Promise ? undefined : (own as Decoded)
      const read = bytes()
      if (!read) return undefined
      const task: Promise<void> = decode(read).then(
        (done) => void (decoded.peek(cell) === task && decoded.set(cell, done)),
        (refused: unknown) => void (decoded.peek(cell) === task && decoded.set(cell, { refused })),
      )
      decoded.set(cell, task)
      asked.push(task)
      return undefined
    },
    /** Whether `cell` is decoded or being decoded. */
    has: (cell: Key) => decoded.peek(cell) !== undefined,
    /** `cell` was taken: its decoded form is dropped. */
    drop: decoded.delete,
    /** The frame is over: the files it did not plan are dropped. */
    end: decoded.end,
    /** Every file dropped: the partition is let go. */
    clear: decoded.clear,
    /** The decodes asked since the last call. */
    asked() {
      const out = asked
      asked = []
      return out
    },
  }
}

/** Where `takeDecoded` reads and spends: the frame's io and its budget. */
type Taking = {
  io: {
    bytes(url: string): Uint8Array | undefined
    failed(url: string): boolean
    request(urls: readonly string[], priority?: number): void
  }
  budget: CellBudget
}

/** Takes each file of `list` whose decode landed while the budget admits it (`taken`: false while
 *  it waits), hands the read ones to `decode`, and asks the unread ones of the streamer — each by
 *  `priority`'s word for it, the files of one priority together, those of the first listed first;
 *  never one refused for good, which waits for nothing: no frame is drawn again for it. True when
 *  one needed now is left for a later frame. */
export function takeDecoded<Key, Decoded extends object>(
  list: readonly Key[],
  { io, budget }: Taking,
  files: ReturnType<typeof createDecodes<Key, Decoded>>,
  url: (key: Key) => string,
  decode: (bytes: Uint8Array, url: string) => Promise<Decoded>,
  taken: (key: Key, decoded: Decoded) => boolean,
  priority?: (key: Key) => number | undefined,
) {
  let ask: Map<number | undefined, string[]> | undefined,
    later = false
  for (const key of list) {
    const address = url(key)
    if (io.failed(address)) continue
    const decoded = files.decoded(
      key,
      () => io.bytes(address),
      (b) => decode(b, address),
    )
    if (!decoded || !budget.admits()) {
      // Asked again while on its way: the frame waits on its landing, never on nothing.
      if (!files.has(key)) appendTo((ask ??= new Map()), priority?.(key), address)
      later = true
      continue
    }
    if (!taken(key, decoded)) continue
    files.drop(key)
    budget.spend()
  }
  if (ask) for (const [by, urls] of ask) io.request(urls, by)
  return later
}
