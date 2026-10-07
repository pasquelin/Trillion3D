import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { grownCapacity, growPlacementRows, type PlacementRows } from '../../placement/rows.ts'
import type { PlacementGrowth } from '../../placement/engineSceneUpdates.ts'
import type { Cut } from './worldCuts.ts'
import type { MaterialEntry } from './worldMaterials.ts'
import { drawnTwoSided } from '../../../../sdk-core/src/physics/soft.ts'
/**
 * A drawn resource: one geometry resource worn with one material entry. Its placements are the
 * rows of one instance buffer (`placement/rows.ts`) the session reads in place; `owners` says
 * which mesh holds each row, `free` which rows are parked and ready to be taken.
 */
export type Batch = {
  readonly key: string
  readonly cut: Cut
  readonly entry: MaterialEntry
  /** Its meshes are cloths (`drawnTwoSided`): their surface is drawn on both faces. */
  readonly twoSided: boolean
  rows: PlacementRows | null
  readonly owners: (Mesh | null)[]
  readonly free: number[]
  /** Meshes that wear this resource now: those holding a row, and those waiting for one. */
  readonly wearers: Set<Mesh>
}
/** Where a mesh is drawn: its batch and, once it holds one, its row. */
export type Seat = { batch: Batch; row: number }
/**
 * The batches of a world and the rows their meshes hold. A mesh is SEATED when its batch is in
 * the open session and a row was free; one that is not waits, and the row it held in the batch it
 * left stays drawn until it holds the new one: a mesh that moves is never missing from a frame.
 * A batch the session holds grows in place (`growHeld`): its rows are replaced by a buffer twice
 * as large at least, the session is handed both (`placement/growth.ts`), and the waiting meshes
 * take the new rows. A batch the session does not hold waits for the next opening (`waiting`),
 * which sizes every batch by the same rule and drops the ones no mesh wears any more. `touched`
 * hears every row taken or parked.
 */
/** A session that grows no buffer in place: a held batch seats on its free rows alone. */
const GROWS_NONE: PlacementGrowth = { growsInPlace: () => false, growPlacements() {} }

export function createWorldBatches(touched: (batch: Batch, row: number) => void) {
  const state: BatchState = {
    touched,
    batches: new Map(),
    seats: new Map(),
    leaving: new Map(),
    short: new Set(),
  }
  const { seats, batches, short } = state
  return {
    seats,
    batches,
    unseat: (mesh: Mesh) => unseat(state, mesh),
    seat: (mesh: Mesh, cut: Cut, entry: MaterialEntry) => seat(state, mesh, cut, entry),
    /** True while some mesh waits for a row: one in a batch the session holds is seated by
     *  `growHeld` where the session grows it, any other only by the next opening. */
    waiting: () => [...short].some((batch) => waitingIn(state, batch) > 0),
    /** Seats the waiting meshes of the batches the session holds, growing full rows where the
     *  session takes it (`grow`). Returns the batches grown. */
    growHeld: (seated: (mesh: Mesh) => void, grow?: PlacementGrowth) =>
      [...short].filter((batch) => batch.rows && !!fit(state, batch, seated, grow ?? GROWS_NONE)),
    /** The batches the next session opens with, each sized and seated by `fit`; one no mesh
     *  wears any more is dropped with its rows. */
    reopen() {
      for (const [key, batch] of batches) {
        if (!batch.wearers.size) {
          batches.delete(key)
          short.delete(batch)
        } else fit(state, batch)
      }
      return [...batches.values()]
    },
  }
}

/** What a world's batches hold (`createWorldBatches`). */
type BatchState = {
  touched: (batch: Batch, row: number) => void
  batches: Map<string, Batch>
  seats: Map<Mesh, Seat>
  /** The rows meshes still hold in the batch they left, drawn until they hold their new one. */
  leaving: Map<Mesh, Seat>
  /** Batches a mesh waits in. */
  short: Set<Batch>
}

function batchOf({ batches }: BatchState, cut: Cut, entry: MaterialEntry, mesh: Mesh) {
  const twoSided = drawnTwoSided(mesh.physics?.soft?.type)
  const key = `${cut.key}/${entry.id}/${mesh.skeleton?.bones.length ?? 0}/${mesh.waves?.waveModel.count ?? 0}/${+twoSided}`
  let batch = batches.get(key)
  if (!batch)
    batches.set(
      key,
      (batch = {
        key,
        cut,
        entry,
        twoSided,
        rows: null,
        owners: [],
        free: [],
        wearers: new Set(),
      }),
    )
  return batch
}

/** Parks a row: it keeps its place in the session, its flag down. */
function park(state: BatchState, { batch, row }: Seat) {
  if (row < 0 || !batch.rows) return
  batch.owners[row] = null
  batch.rows.live[row] = 0
  batch.free.push(row)
  state.touched(batch, row)
}

function parkLeaving(state: BatchState, mesh: Mesh) {
  const seat = state.leaving.get(mesh)
  if (seat && state.leaving.delete(mesh)) park(state, seat)
}

/** Takes `mesh` off its batch; returns the seat it left. */
function leave({ seats }: BatchState, mesh: Mesh) {
  const seat = seats.get(mesh)
  if (seat && seats.delete(mesh)) seat.batch.wearers.delete(mesh)
  return seat
}

/** A mesh no longer drawn: every row it holds is parked. */
function unseat(state: BatchState, mesh: Mesh) {
  parkLeaving(state, mesh)
  const seat = leave(state, mesh)
  if (seat) park(state, seat)
}

function waitingIn({ seats }: BatchState, batch: Batch) {
  let waiting = 0
  for (const mesh of batch.wearers) if (seats.get(mesh)!.row < 0) waiting++
  return waiting
}

/** Sizes `batch`'s rows for the rows taken and its waiting wearers — kept when they suffice,
 *  doubled at least when they do not, the rows held copied first and the new ones parked —, and
 *  hands a session holding them the growth (`grow`). Returns the rows it replaced, null when it
 *  kept them, false when that session does not take it. */
function size(state: BatchState, batch: Batch, grow?: PlacementGrowth) {
  const before = batch.rows
  const held = before?.capacity ?? 0,
    needed = held - batch.free.length + waitingIn(state, batch)
  if (needed <= held) return null
  if (before && grow && (batch.cut.drawn.deformation || [...batch.wearers].some((m) => m.waves)))
    return false
  if (before && grow && !grow.growsInPlace([before], grownCapacity(held, needed))) return false
  const rows = growPlacementRows(before, needed)
  const { capacity } = rows
  for (let row = capacity - 1; row >= held; row--) batch.free.push(row)
  batch.owners.length = capacity
  batch.owners.fill(null, held)
  rows.sources = batch.owners
  rows.sourceModels = batch.wearers
  batch.rows = rows
  if (before && grow) grow.growPlacements(before, rows)
  return before
}

/** Sizes `batch` (`size`) and seats every waiting wearer, handing it to `seated`. */
function fit(
  state: BatchState,
  batch: Batch,
  seated?: (mesh: Mesh) => void,
  grow?: PlacementGrowth,
) {
  const before = size(state, batch, grow)
  if (before === false) return false
  for (const mesh of batch.wearers) {
    const seat = state.seats.get(mesh)!
    if (seat.row >= 0) continue
    seat.row = batch.free.pop()!
    batch.owners[seat.row] = mesh
    parkLeaving(state, mesh)
    seated?.(mesh)
  }
  state.short.delete(batch)
  return before
}

/**
 * Seats `mesh` on `cut` × `entry`. True for a new row whose matrix needs writing; false when
 * waiting or already seated. Rereading dynamic geometry does not move its pose (#573).
 */
function seat(state: BatchState, mesh: Mesh, cut: Cut, entry: MaterialEntry) {
  const { seats, leaving } = state
  const batch = batchOf(state, cut, entry, mesh)
  const held = seats.get(mesh)
  if (held?.batch === batch) return false
  if (leaving.get(mesh)?.batch === batch) parkLeaving(state, mesh)
  if (held && leave(state, mesh) && held.row >= 0) leaving.set(mesh, held)
  batch.wearers.add(mesh)
  const row = batch.rows ? (batch.free.pop() ?? -1) : -1
  seats.set(mesh, { batch, row })
  if (row < 0) {
    state.short.add(batch)
    return false
  }
  batch.owners[row] = mesh
  parkLeaving(state, mesh)
  state.touched(batch, row)
  return true
}
