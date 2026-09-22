import type { Mesh } from '../../../sdk-core/world/object/mesh.ts';
import { createPlacementRows, type PlacementRows } from '../../placement/placementRows.ts';
import type { Cut } from './worldCuts.ts';
import type { MaterialEntry } from './worldMaterials.ts';

/**
 * A drawn resource: one geometry resource worn with one material entry. Its placements are the
 * rows of one instance buffer (`placementRows.ts`) the session reads in place; `owners` says
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
 * the open session and a row was free; one that is not — a resource the session does not hold,
 * or a buffer already full — waits for the next opening, which gives every batch the rows its
 * wearers need: twice what it had when it grew, so a scene that grows by one mesh at a time
 * opens a number of times that grows with the logarithm of its size, never with its size.
 */
export function createWorldBatches() {
  const batches = new Map<string, Batch>();
  const seats = new Map<Mesh, Seat>();
  /** Meshes seated on no row yet: what asks for an opening. */
  let waiting = 0;
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
  return {
    seats,
    batches,
    unseat,
    /**
     * Seats `mesh` on the batch of `cut` × `entry`. True when it holds a row — the caller writes
     * its matrix —, false when it waits for an opening.
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
        return false;
      }
      batch.owners[row] = mesh;
      touched(batch, row);
      return true;
    },
    /** True while some mesh waits for a row: the session must be opened again. */
    waiting: () => waiting > 0,
    /**
     * The batches the next session opens with, their buffers sized for their wearers — kept
     * when they suffice, doubled at least when they do not — and every mesh seated. A batch no
     * mesh wears any more is dropped with its rows. Returns the batches kept.
     */
    reopen() {
      for (const [key, batch] of batches) {
        if (!batch.wearers.size) {
          batches.delete(key);
          continue;
        }
        const held = batch.rows?.capacity ?? 0;
        const needed = batch.wearers.size;
        const capacity = needed <= held ? held : held ? Math.max(needed, held * 2) : needed;
        if (capacity !== held) {
          const rows = createPlacementRows(capacity);
          if (batch.rows) {
            rows.matrices.set(batch.rows.matrices);
            rows.live.set(batch.rows.live);
          }
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
        }
      }
      waiting = 0;
      return [...batches.values()];
    },
  };
}
