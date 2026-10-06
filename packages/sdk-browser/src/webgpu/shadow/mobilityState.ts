import { poseHoldsBox, sameElements } from '../../math/matrixElements.ts'
import { MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../../gpu/shadow/mobilityBits.ts'

/**
 * The state of `createShadowMobility`, fields of one object (`mobility.ts`).
 *
 * `moving` and `lastMoved`: whether each placement moves, and the `settle` frame it last moved at;
 * `frame`: `settle` calls so far (the scene frame number); `movingList`: the placements moving now,
 * the ones `settle` walks; `dirty` and `dirtyList`: the placements whose rows' per-placement bits
 * must be written again, once each; `poses`: the pose each placement was last seen at, from the
 * layout on — a write that leaves it where it stands, a sleeping body's pose copied again, a row
 * inside a written range, is no move; `rows`: one word per row; `rowRank`: the placement each row
 * was last written with (-1: none), and `indexStart`/`indexRows` its rows by placement
 * (`indexStart[rank]..indexStart[rank + 1]` in `indexRows`), rebuilt when a row changed placement
 * and a placement is dirty (`indexStale`); `wholeRows`: every row is written at the next
 * `writeRows`. `leads`: the parent slot each placement follows on the GPU
 * (`../../placement/gpuCompose.ts`), -1 for none — its rows take no CPU pose while the parent
 * moves — sized by `follow` itself, since a link may come before `ensure`; per slot, `leadMoved`
 * the `settle` frame its parent last moved at, `leadMoving` 1 once its followers were made moving,
 * `leadDeclared` the `settle` call that last declared its box.
 */
export function createMobilityState() {
  return {
    moving: new Uint8Array(0),
    lastMoved: new Uint32Array(0),
    frame: 0,
    movingList: [] as number[],
    dirty: new Uint8Array(0),
    dirtyList: [] as number[],
    poses: new Float64Array(0),
    rows: new Uint32Array(0),
    rowRank: new Int32Array(0),
    indexStart: new Uint32Array(1),
    indexRows: new Uint32Array(0),
    indexStale: true,
    wholeRows: true,
    leads: new Int32Array(0),
    leadMoved: new Uint32Array(0),
    leadMoving: new Uint8Array(0),
    leadDeclared: new Uint32Array(0),
  }
}

export type MobilityState = ReturnType<typeof createMobilityState>

/** Placement `rank`'s rows must be written again: it starts or stops casting, or is parked or
 *  taken (`MOBILITY_SHADOWLESS`). */
export function touchRank(s: MobilityState, rank: number) {
  if (rank < 0 || rank >= s.dirty.length || s.dirty[rank]) return
  s.dirty[rank] = 1
  s.dirtyList.push(rank)
}

/** Placement `rank` starts moving at this frame: the static slice leaves it out. */
export function promoteRank(s: MobilityState, rank: number) {
  s.moving[rank] = 1
  s.lastMoved[rank] = s.frame
  s.movingList.push(rank)
  touchRank(s, rank)
}

/** The bits a placement gives each of its rows. A blended caster follows its placement like any
 *  caster: the VSM transmission atlas keeps a still one in the static slice
 *  (`../../vsm/transmissionWgsl.ts`). */
export const rankBits = (s: MobilityState, rank: number, shadowless: (rank: number) => boolean) =>
  rank < 0
    ? 0
    : (s.moving[rank] === 1 ? MOBILITY_MOVING : 0) | (shadowless(rank) ? MOBILITY_SHADOWLESS : 0)

/** Whether `world` leaves placement `rank` where it was last seen: the same pose, or, given its
 *  local `box`, one that moves it by less than a float32 step (`poseHoldsBox`). */
export const holdsPose = (
  s: MobilityState,
  rank: number,
  world: ArrayLike<number>,
  box?: ArrayLike<number>,
) => (box ? poseHoldsBox(s.poses, world, box, rank * 16) : sameElements(s.poses, world, rank * 16))

/** The rows of each placement, from the placement each row was last written with. */
export function rebuildRowIndex(s: MobilityState) {
  const ranks = s.moving.length
  if (s.indexStart.length !== ranks + 1) s.indexStart = new Uint32Array(ranks + 1)
  else s.indexStart.fill(0)
  let count = 0
  for (let row = 0; row < s.rowRank.length; row++) {
    const rank = s.rowRank[row]
    if (rank >= 0 && rank < ranks) {
      s.indexStart[rank + 1]++
      count++
    }
  }
  for (let rank = 0; rank < ranks; rank++) s.indexStart[rank + 1] += s.indexStart[rank]
  if (s.indexRows.length < count) s.indexRows = new Uint32Array(count)
  const at = s.indexStart.slice(0, ranks)
  for (let row = 0; row < s.rowRank.length; row++) {
    const rank = s.rowRank[row]
    if (rank >= 0 && rank < ranks) s.indexRows[at[rank]++] = row
  }
  s.indexStale = false
}

/** The state is sized for `placements` roots: the ones that stay keep theirs, the new ones start
 *  still at the poses `worldOf` gives. */
function resizePlacements(
  s: MobilityState,
  placements: number,
  worldOf: (rank: number) => ArrayLike<number>,
) {
  const kept = Math.min(s.moving.length, placements)
  const held = { moving: s.moving, poses: s.poses, lastMoved: s.lastMoved }
  // Every slot's followers are weighed again at its parent's next move (`moveLead`).
  s.leadMoving.fill(0)
  s.moving = new Uint8Array(placements)
  s.poses = new Float64Array(placements * 16)
  s.lastMoved = new Uint32Array(placements)
  s.moving.set(held.moving.subarray(0, kept))
  s.lastMoved.set(held.lastMoved.subarray(0, kept))
  s.movingList = []
  for (let rank = 0; rank < kept; rank++) if (s.moving[rank]) s.movingList.push(rank)
  s.dirty = new Uint8Array(placements)
  s.dirtyList = s.dirtyList.filter((rank) => rank < placements)
  for (const rank of s.dirtyList) s.dirty[rank] = 1
  s.indexStale = true
  s.poses.set(held.poses.subarray(0, kept * 16))
  for (let rank = kept; rank < placements; rank++) s.poses.set(worldOf(rank), rank * 16)
}

/** Sizes the state for `placements` roots and `drawSlots` rows; a new layout starts still, at
 *  the poses `worldOf` gives. Placements that joined in place
 *  (`../../placement/webgpuGrowth.ts`) start still beside the others, which keep their state,
 *  and so do they all when the table grows (`../row/grow.ts`): its row words are written anew. */
export function ensureLayout(
  s: MobilityState,
  placements: number,
  drawSlots: number,
  worldOf: (rank: number) => ArrayLike<number>,
) {
  if (s.moving.length === placements && s.rows.length === drawSlots) return
  if (s.moving.length !== placements) resizePlacements(s, placements, worldOf)
  if (s.rows.length === Math.max(1, drawSlots)) return
  s.rows = new Uint32Array(Math.max(1, drawSlots))
  s.rowRank = new Int32Array(s.rows.length).fill(-1)
  s.indexStale = true
  s.wholeRows = true
}
