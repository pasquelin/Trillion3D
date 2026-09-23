import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { growPlacementRows, type PlacementRows } from '../../placement/rows.ts';
import type { Cut } from './worldCuts.ts';
import type { MaterialEntry } from './worldMaterials.ts';

/**
 * A drawn resource: one geometry resource worn with one material entry. Its placements are the
 * rows of one instance buffer (`placement/rows.ts`) the session reads in place; `owners` says
 * which mesh holds each row, `free` which rows are parked and ready to be taken.
 */
export type Batch = {
  readonly key: string;
  readonly cut: Cut;
  readonly entry: MaterialEntry;
  rows: PlacementRows | null;
  readonly owners: (Mesh | null)[];
  readonly free: number[];
  /** Meshes that wear this resource now: those holding a row, and those waiting for one. */
  readonly wearers: Set<Mesh>;
};

/** Where a mesh is drawn: its batch and, once it holds one, its row. */
export type Seat = { batch: Batch; row: number };

/**
 * The batches of a world and the rows their meshes hold. A mesh is SEATED when its batch is in
 * the open session and a row was free; one that is not waits. A batch the session holds grows in
 * place (`growHeld`): its rows are replaced by a buffer twice as large at least, the session is
 * handed both (`placement/growth.ts`), and the waiting meshes take the new rows. A batch the
 * session does not hold — a resource or material entry it never had — waits for the next
 * opening, which sizes every batch by the same rule.
 */
export function createWorldBatches() {
  const batches = new Map<string, Batch>();
  const seats = new Map<Mesh, Seat>();
  /** Meshes seated on no row yet, and the batches they wait in. */
  let waiting = 0;
  const short = new Set<Batch>();
  const batchOf = (cut: Cut, entry: MaterialEntry) => {
    const key = `${cut.key}/${entry.key}`;
    let batch = batches.get(key);
    if (!batch)
      batches.set(
        key,
        (batch = { key, cut, entry, rows: null, owners: [], free: [], wearers: new Set() }),
      );
    return batch;
  };
  /** Parks a mesh's row: the row keeps its place in the session, its flag down. */
  const unseat = (mesh: Mesh, touched: (batch: Batch, row: number) => void) => {
    const seat = seats.get(mesh);
    if (!seat) return;
    seats.delete(mesh);
    seat.batch.wearers.delete(mesh);
    const { batch, row } = seat;
    if (row < 0) waiting--;
    if (row < 0 || !batch.rows) return;
    batch.owners[row] = null;
    batch.rows.live[row] = 0;
    batch.free.push(row);
    touched(batch, row);
  };
  /**
   * Sizes `batch`'s rows for its wearers — kept when they suffice, doubled at least when they do
   * not, the rows held copied first and the new ones parked — and seats every waiting wearer,
   * handing it to `seated`. Returns the rows it replaced, or null when it kept them.
   */
  const fit = (batch: Batch, seated?: (mesh: Mesh) => void) => {
    const before = batch.rows;
    const held = before?.capacity ?? 0,
      needed = batch.wearers.size;
    if (needed > held) {
      const rows = growPlacementRows(before, needed);
      const { capacity } = rows;
      for (let row = capacity - 1; row >= held; row--) batch.free.push(row);
      batch.owners.length = capacity;
      batch.owners.fill(null, held);
      batch.rows = rows;
    }
    for (const mesh of batch.wearers) {
      const seat = seats.get(mesh)!;
      if (seat.row >= 0) continue;
      seat.row = batch.free.pop()!;
      batch.owners[seat.row] = mesh;
      waiting--;
      seated?.(mesh);
    }
    short.delete(batch);
    return before && batch.rows !== before ? before : null;
  };
  return {
    seats,
    batches,
    unseat,
    /**
     * Seats `mesh` on the batch of `cut` × `entry`. True when it holds a row — the caller writes
     * its matrix —, false when it waits.
     */
    seat(mesh: Mesh, cut: Cut, entry: MaterialEntry, touched: (b: Batch, row: number) => void) {
      const batch = batchOf(cut, entry);
      const held = seats.get(mesh);
      if (held?.batch === batch && held.row >= 0) return true;
      unseat(mesh, touched);
      batch.wearers.add(mesh);
      const row = batch.rows ? (batch.free.pop() ?? -1) : -1;
      seats.set(mesh, { batch, row });
      if (row < 0) {
        waiting++;
        short.add(batch);
        return false;
      }
      batch.owners[row] = mesh;
      touched(batch, row);
      return true;
    },
    /** True while some mesh waits for a row. */
    waiting: () => waiting > 0,
    /**
     * Seats the waiting meshes of the batches the session holds, growing their rows where they are
     * full. Returns each buffer replaced, with its batch, for the session to grow in place.
     */
    growHeld(seated: (mesh: Mesh) => void) {
      const grown: { batch: Batch; from: PlacementRows }[] = [];
      for (const batch of short) {
        if (!batch.rows) continue;
        const from = fit(batch, seated);
        if (from) grown.push({ batch, from });
      }
      return grown;
    },
    /**
     * The batches the next session opens with, each sized and seated by `fit`. A batch no mesh
     * wears any more is dropped with its rows. Returns the batches kept.
     */
    reopen() {
      for (const [key, batch] of batches) {
        if (!batch.wearers.size) {
          batches.delete(key);
          short.delete(batch);
        } else fit(batch);
      }
      return [...batches.values()];
    },
  };
}
