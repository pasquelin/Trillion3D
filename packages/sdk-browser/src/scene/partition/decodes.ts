/**
 * THE CELLS READ AND DECODED, WAITING FOR A FRAME TO PLACE THEM (#575). A cell's verified bytes
 * are handed to the decode pool as soon as a frame needs them (`cellDecode.ts`); its rows are
 * placed by a later frame, within the one integration budget (`cells.ts`). Only the cells the
 * last frame planned are kept: the map follows the view, not the world.
 */
import type { CellRows } from './cellDecode.ts';

export function createCellDecodes() {
  /** Each cell's rows, the decode under way, or why its file was refused. */
  const decoded = new Map<number, CellRows | Promise<void> | { refused: unknown }>();
  let asked: Promise<void>[] = [];
  return {
    /** `cell`'s rows once decoded, else `undefined`: its bytes, once `bytes` reads them, are
     *  handed to `decode` first. A file the decode refused is thrown, as its frame reads it. */
    rows(
      cell: number,
      bytes: () => Uint8Array | undefined,
      decode: (bytes: Uint8Array) => Promise<CellRows>,
    ) {
      const own = decoded.get(cell);
      if (own && 'refused' in own) throw own.refused;
      if (own) return own instanceof Promise ? undefined : own;
      const read = bytes();
      if (!read) return undefined;
      const task: Promise<void> = decode(read).then(
        (rows) => void (decoded.get(cell) === task && decoded.set(cell, rows)),
        (refused: unknown) => void (decoded.get(cell) === task && decoded.set(cell, { refused })),
      );
      decoded.set(cell, task);
      asked.push(task);
      return undefined;
    },
    /** Whether `cell` is decoded or being decoded. */
    has: (cell: number) => decoded.has(cell),
    /** `cell` was placed, or left: its rows are dropped. */
    drop: (cell: number) => void decoded.delete(cell),
    /** Drops every cell but those `planned`. */
    keep(planned: ReadonlySet<number>) {
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
