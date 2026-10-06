/**
 * THE FILES READ AND DECODED, WAITING FOR A FRAME TO TAKE THEM: a cell file, or a page of
 * the cell index. Its verified bytes are handed to the decode pool as soon as a frame needs them
 * (`cellDecode.ts`, `readCellPage`); a later frame places its rows, or opens the page, within the
 * one integration budget (`cells.ts`). Only what the last frame planned is kept: the map follows
 * the view, not the world.
 */
export function createDecodes<Key, Decoded extends object>() {
  /** Each file's decoded form, the decode under way, or why it was refused. */
  const decoded = new Map<Key, Decoded | Promise<void> | { refused: unknown }>()
  let asked: Promise<void>[] = []
  return {
    /** `cell`'s decoded form, else `undefined`: its bytes, once `bytes` reads them, are handed to
     *  `decode` first. A file the decode refused is thrown, as its frame reads it. */
    decoded(
      cell: Key,
      bytes: () => Uint8Array | undefined,
      decode: (bytes: Uint8Array) => Promise<Decoded>,
    ) {
      const own = decoded.get(cell)
      if (own && 'refused' in own) throw own.refused
      if (own) return own instanceof Promise ? undefined : (own as Decoded)
      const read = bytes()
      if (!read) return undefined
      const task: Promise<void> = decode(read).then(
        (done) => void (decoded.get(cell) === task && decoded.set(cell, done)),
        (refused: unknown) => void (decoded.get(cell) === task && decoded.set(cell, { refused })),
      )
      decoded.set(cell, task)
      asked.push(task)
      return undefined
    },
    /** Whether `cell` is decoded or being decoded. */
    has: (cell: Key) => decoded.has(cell),
    /** `cell` was taken: its decoded form is dropped. */
    drop: (cell: Key) => void decoded.delete(cell),
    /** Drops every file but those of the `planned` lists. */
    keep(...planned: (readonly Key[])[]) {
      if (!decoded.size) return
      const kept = new Set(planned.flat())
      for (const cell of decoded.keys()) if (!kept.has(cell)) decoded.delete(cell)
    },
    /** The decodes asked since the last call. */
    asked() {
      const out = asked
      asked = []
      return out
    },
  }
}

/** Where `takeDecoded` reads and spends: the frame's io, its budget, and whether its list is read
 *  ahead of need. */
type Taking = {
  io: { bytes(url: string): Uint8Array | undefined; loading(url: string): boolean } & {
    request(urls: readonly string[], ahead: boolean): void
  }
  budget: { admits(): boolean; spend(): void }
  ahead: boolean
}

/** Takes each file of `list` whose decode landed while the budget admits it (`taken`, told `at`:
 *  false while it waits), hands the read ones to `decode`, and asks the unread ones of the streamer.
 *  True when one needed now is left for a later frame. */
export function takeDecoded<Key, Decoded extends object, At extends Taking>(
  list: readonly Key[],
  at: At,
  files: ReturnType<typeof createDecodes<Key, Decoded>>,
  url: (key: Key) => string,
  decode: (bytes: Uint8Array, url: string) => Promise<Decoded>,
  taken: (key: Key, decoded: Decoded, at: At) => boolean,
) {
  const { io, budget, ahead } = at,
    ask: string[] = []
  let later = false
  for (const key of list) {
    const address = url(key)
    const decoded = files.decoded(
      key,
      () => io.bytes(address),
      (b) => decode(b, address),
    )
    if (!decoded || !budget.admits()) {
      if (!files.has(key) && !io.loading(address)) ask.push(address)
      later ||= !ahead
      continue
    }
    if (!taken(key, decoded, at)) continue
    files.drop(key)
    budget.spend()
  }
  if (ask.length) io.request(ask, ahead)
  return later
}
