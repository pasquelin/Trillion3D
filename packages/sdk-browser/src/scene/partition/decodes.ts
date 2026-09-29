/**
 * THE FILES READ AND DECODED, WAITING FOR A FRAME TO TAKE THEM (#575): a cell file, or a page of
 * the cell index. Its verified bytes are handed to the decode pool as soon as a frame needs them
 * (`cellDecode.ts`, `readCellPage`); a later frame places its rows, or opens the page, within the
 * one integration budget (`cells.ts`). Only what the last frame planned is kept: the map follows
 * the view, not the world.
 */
export function createDecodes<Key, Decoded extends object>() {
  /** Each file's decoded form, the decode under way, or why it was refused. */
  const decoded = new Map<Key, Decoded | Promise<void> | { refused: unknown }>();
  let asked: Promise<void>[] = [];
  return {
    /** `cell`'s decoded form, else `undefined`: its bytes, once `bytes` reads them, are handed to
     *  `decode` first. A file the decode refused is thrown, as its frame reads it. */
    decoded(
      cell: Key,
      bytes: () => Uint8Array | undefined,
      decode: (bytes: Uint8Array) => Promise<Decoded>,
    ) {
      const own = decoded.get(cell);
      if (own && 'refused' in own) throw own.refused;
      if (own) return own instanceof Promise ? undefined : (own as Decoded);
      const read = bytes();
      if (!read) return undefined;
      const task: Promise<void> = decode(read).then(
        (done) => void (decoded.get(cell) === task && decoded.set(cell, done)),
        (refused: unknown) => void (decoded.get(cell) === task && decoded.set(cell, { refused })),
      );
      decoded.set(cell, task);
      asked.push(task);
      return undefined;
    },
    /** Whether `cell` is decoded or being decoded. */
    has: (cell: Key) => decoded.has(cell),
    /** `cell` was taken: its decoded form is dropped. */
    drop: (cell: Key) => void decoded.delete(cell),
    /** Drops every file but those `planned`. */
    keep(planned: ReadonlySet<Key>) {
      for (const cell of decoded.keys()) if (!planned.has(cell)) decoded.delete(cell);
    },
    /** The decodes asked since the last call. */
    asked() {
      const out = asked;
      asked = [];
      return out;
    },
  };
}
