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
 * the open session and a row was free; one that is not waits, and the row it held in the batch it
 * left stays drawn until it holds the new one: a mesh that moves is never missing from a frame.
 * A batch the session holds grows in place (`growHeld`): its rows are replaced by a buffer twice
 * as large at least, the session is handed both (`placement/growth.ts`), and the waiting meshes
 * take the new rows. A batch the session does not hold is mounted into it (`mountable`, #572),
 * or waits for the next opening, which sizes every batch by the same rule; one no mesh wears or
 * leaves any more is taken out (`vacant`). `touched` hears every row taken or parked.
 */
export function createWorldBatches(touched: (batch: Batch, row: number) => void) {
  const batches = new Map<string, Batch>();
  const seats = new Map<Mesh, Seat>();
  /** The rows meshes still hold in the batch they left, drawn until they hold their new one. */
  const leaving = new Map<Mesh, Seat>();
  /** Batches a mesh waits in; batches that lost a wearer or a row; batches the open session
   *  mounts, whose rows exist, all parked, none taken until it draws them. */
  const short = new Set<Batch>(),
    emptied = new Set<Batch>(),
    mounting = new Set<Batch>();
  const batchOf = (cut: Cut, entry: MaterialEntry) => {
    const key = `${cut.key}/${entry.id}`;
    let batch = batches.get(key);
    if (!batch)
      batches.set(
        key,
        (batch = { key, cut, entry, rows: null, owners: [], free: [], wearers: new Set() }),
      );
    return batch;
  };
  /** Parks a row: it keeps its place in the session, its flag down. */
  const park = ({ batch, row }: Seat) => {
    emptied.add(batch);
    if (row < 0 || !batch.rows) return;
    batch.owners[row] = null;
    batch.rows.live[row] = 0;
    batch.free.push(row);
    touched(batch, row);
  };
  const parkLeaving = (mesh: Mesh) => {
    const seat = leaving.get(mesh);
    if (seat && leaving.delete(mesh)) park(seat);
  };
  /** Takes `mesh` off its batch; returns the seat it left. */
  const leave = (mesh: Mesh) => {
    const seat = seats.get(mesh);
    if (seat && seats.delete(mesh) && seat.batch.wearers.delete(mesh)) emptied.add(seat.batch);
    return seat;
  };
  /** A mesh no longer drawn: every row it holds is parked. */
  const unseat = (mesh: Mesh) => {
    parkLeaving(mesh);
    const seat = leave(mesh);
    if (seat) park(seat);
  };
  const waitingIn = (batch: Batch) => {
    let waiting = 0;
    for (const mesh of batch.wearers) if (seats.get(mesh)!.row < 0) waiting++;
    return waiting;
  };
  /** Sizes `batch`'s rows for the rows taken and its waiting wearers — kept when they suffice,
   *  doubled at least when they do not, the rows held copied first and the new ones parked.
   *  Returns the rows it replaced, or null when it kept them. */
  const size = (batch: Batch) => {
    const before = batch.rows;
    const held = before?.capacity ?? 0,
      needed = held - batch.free.length + waitingIn(batch);
    if (needed <= held) return null;
    const rows = growPlacementRows(before, needed);
    const { capacity } = rows;
    for (let row = capacity - 1; row >= held; row--) batch.free.push(row);
    batch.owners.length = capacity;
    batch.owners.fill(null, held);
    batch.rows = rows;
    return before;
  };
  /** Sizes `batch` (`size`) and seats every waiting wearer, handing it to `seated`. */
  const fit = (batch: Batch, seated?: (mesh: Mesh) => void) => {
    const before = size(batch);
    for (const mesh of batch.wearers) {
      const seat = seats.get(mesh)!;
      if (seat.row >= 0) continue;
      seat.row = batch.free.pop()!;
      batch.owners[seat.row] = mesh;
      parkLeaving(mesh);
      seated?.(mesh);
    }
    short.delete(batch);
    return before;
  };
  return {
    seats,
    batches,
    unseat,
    /**
     * Seats `mesh` on the batch of `cut` × `entry`. True when it holds a row — the caller writes
     * its matrix —, false when it waits.
     */
    seat(mesh: Mesh, cut: Cut, entry: MaterialEntry) {
      const batch = batchOf(cut, entry);
      const held = seats.get(mesh);
      if (held?.batch === batch) return held.row >= 0;
      if (leaving.get(mesh)?.batch === batch) parkLeaving(mesh);
      if (held && leave(mesh) && held.row >= 0) leaving.set(mesh, held);
      batch.wearers.add(mesh);
      const row = batch.rows && !mounting.has(batch) ? (batch.free.pop() ?? -1) : -1;
      seats.set(mesh, { batch, row });
      if (row < 0) {
        short.add(batch);
        return false;
      }
      batch.owners[row] = mesh;
      parkLeaving(mesh);
      touched(batch, row);
      return true;
    },
    /** True while some mesh waits for a row no mounting will give it. */
    waiting: () => [...short].some((batch) => !mounting.has(batch) && waitingIn(batch) > 0),
    /** Seats the waiting meshes of the batches the session holds, growing full rows on a session
     *  that `grows`. Returns each buffer replaced, with its batch, for the session to grow. */
    growHeld(seated: (mesh: Mesh) => void, grows: boolean) {
      const grown: { batch: Batch; from: PlacementRows }[] = [];
      for (const batch of short) {
        if (!batch.rows || mounting.has(batch)) continue;
        if (!grows && waitingIn(batch) > batch.free.length) continue;
        const from = fit(batch, seated);
        if (from) grown.push({ batch, from });
      }
      return grown;
    },
    /** The batches worn but in no session, sized with every row parked and marked mounting: the
     *  caller mounts each, then says it is `mounted`. */
    mountable() {
      const found = [...short].filter((batch) => !batch.rows && waitingIn(batch));
      for (const batch of found) {
        size(batch);
        mounting.add(batch);
      }
      return found;
    },
    /** Whether `mesh` waits in a batch still mounting: it moves on once that one is drawn. */
    mounting: (mesh: Mesh) => mounting.has(seats.get(mesh)?.batch as Batch),
    /** `batch` is drawn by the session: its waiting wearers take rows at the next `growHeld`. */
    mounted: (batch: Batch) => mounting.delete(batch),
    /** The batches no mesh wears or leaves any more, taken out: those with rows, for the session
     *  to unmount. One still mounting waits for its mounting to end. */
    vacant() {
      const found: Batch[] = [];
      for (const batch of emptied) {
        if (mounting.has(batch)) continue;
        emptied.delete(batch);
        if (batch.wearers.size || batch.free.length < (batch.rows?.capacity ?? 0)) continue;
        batches.delete(batch.key);
        short.delete(batch);
        if (batch.rows) found.push(batch);
      }
      return found;
    },
    /** The batches the next session opens with, each sized and seated by `fit`; one no mesh
     *  wears any more is dropped with its rows. */
    reopen() {
      mounting.clear();
      for (const [key, batch] of batches) {
        if (!batch.wearers.size) {
          batches.delete(key);
          short.delete(batch);
        } else fit(batch);
      }
      emptied.clear();
      return [...batches.values()];
    },
  };
}
