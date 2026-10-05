import { poseHoldsBox, sameElements } from '../../math/matrixElements.ts';
import { MOVE_MOVING, MOVE_NONE, MOVE_PROMOTED } from '../../placement/update.ts';
import {
  MOBILITY_CORNER_SHIFT,
  MOBILITY_CUTOUT,
  MOBILITY_MOVING,
  MOBILITY_SHADOWLESS,
} from '../../gpu/shadow/mobilityBits.ts';

/**
 * WHICH PLACEMENTS MOVE, as the shadow pages see them. A
 * placement — a root of the cut, the rank a page-table row carries (`PageInfo.placement`) —
 * becomes moving the first time it moves: from then on the static slice of the virtual shadow
 * maps leaves it out, and its later moves redraw only the dynamic slice of the pages they cross.
 * The first move is the one that changes the static slice, so it stales those pages whole.
 *
 * A moving placement that has not moved for `settle`'s threshold of frames turns static again
 * (100 frames): with the receiver mask, every dynamic page is drawn again each frame, so a
 * resting dynamic caster would cost its pages forever. What the GPU reads is one word per row: the rows the page table rewrites, and
 * the rows of the placements whose mobility or casting changed (`touch`) — the dirty
 * primitive upload, never the whole table for one placement.
 */
export function createShadowMobility() {
  let moving = new Uint8Array(0),
    /** The `settle` frame each placement last moved at. */
    lastMoved = new Uint32Array(0),
    /** `settle` calls so far (the scene frame number). */
    frame = 0,
    /** Placements moving now, the ones `settle` walks. */
    movingList: number[] = [],
    /** Placements whose rows' per-placement bits must be written again, once each. */
    dirty = new Uint8Array(0),
    dirtyList: number[] = [],
    /** The pose each placement was last seen at, from the layout on: a write that leaves it where
     *  it stands — a sleeping body's pose copied again, a row inside a written range — is no
     *  move. */
    poses = new Float64Array(0),
    rows = new Uint32Array(0),
    /** The placement each row was last written with (-1: none), and its rows by placement
     *  (`indexStart[rank]..indexStart[rank + 1]` in `indexRows`), rebuilt when a row changed
     *  placement and a placement is dirty. */
    rowRank = new Int32Array(0),
    indexStart = new Uint32Array(1),
    indexRows = new Uint32Array(0),
    indexStale = true,
    wholeRows = true,
    /** The parent slot each placement follows on the GPU (`../../placement/gpuCompose.ts`), -1 for
     *  none: its rows take no CPU pose while the parent moves. Sized by `follow` itself, since a link
     *  may come before `ensure`. Per slot: the `settle` frame its parent last moved at, 1 once its
     *  followers were made moving, and the `settle` call that last declared its box. */
    leads = new Int32Array(0),
    leadMoved = new Uint32Array(0),
    leadMoving = new Uint8Array(0),
    leadDeclared = new Uint32Array(0);
  /** The bits a placement gives each of its rows. A blended caster follows its placement like any
   *  caster: the VSM transmission atlas keeps a still one in the static slice
   *  (`../../vsm/transmissionWgsl.ts`). */
  const rankBits = (rank: number, shadowless: (rank: number) => boolean) =>
    rank < 0
      ? 0
      : (moving[rank] === 1 ? MOBILITY_MOVING : 0) | (shadowless(rank) ? MOBILITY_SHADOWLESS : 0);
  /** Whether `world` leaves placement `rank` where it was last seen: the same pose, or, given its
   *  local `box`, one that moves it by less than a float32 step (`poseHoldsBox`). */
  const holds = (rank: number, world: ArrayLike<number>, box?: ArrayLike<number>) =>
    box ? poseHoldsBox(poses, world, box, rank * 16) : sameElements(poses, world, rank * 16);
  /** Placement `rank` starts moving at this frame: the static slice leaves it out. */
  const promote = (rank: number) => {
    moving[rank] = 1;
    lastMoved[rank] = frame;
    movingList.push(rank);
    touch(rank);
  };
  const touch = (rank: number) => {
    if (rank < 0 || rank >= dirty.length || dirty[rank]) return;
    dirty[rank] = 1;
    dirtyList.push(rank);
  };
  /** The rows of each placement, from the placement each row was last written with. */
  const rebuildIndex = () => {
    const ranks = moving.length;
    if (indexStart.length !== ranks + 1) indexStart = new Uint32Array(ranks + 1);
    else indexStart.fill(0);
    let count = 0;
    for (let row = 0; row < rowRank.length; row++) {
      const rank = rowRank[row];
      if (rank >= 0 && rank < ranks) {
        indexStart[rank + 1]++;
        count++;
      }
    }
    for (let rank = 0; rank < ranks; rank++) indexStart[rank + 1] += indexStart[rank];
    if (indexRows.length < count) indexRows = new Uint32Array(count);
    const at = indexStart.slice(0, ranks);
    for (let row = 0; row < rowRank.length; row++) {
      const rank = rowRank[row];
      if (rank >= 0 && rank < ranks) indexRows[at[rank]++] = row;
    }
    indexStale = false;
  };
  return {
    /** True once placement `rank` has moved: the static layer does not hold it. */
    moves: (rank: number) => moving[rank] === 1,
    /** The pose placement `rank` was last seen at, a view of the state; none past the placements
     *  it is sized for. */
    poseOf: (rank: number) =>
      rank >= 0 && rank < moving.length ? poses.subarray(rank * 16, rank * 16 + 16) : undefined,
    /** One word per row: `MOBILITY_MOVING` for a row of a moving placement, `MOBILITY_CUTOUT` for
     *  one whose fragments can be cut, `MOBILITY_SHADOWLESS` for one that casts no shadow, and its
     *  corners above `MOBILITY_CORNER_SHIFT` (`../../gpu/shadow/mobilityBits.ts`). */
    get rowWords() {
      return rows;
    },
    holds,
    /** Sizes the state for `placements` roots and `drawSlots` rows; a new layout starts still, at
     *  the poses `worldOf` gives. Placements that joined in place
     *  (`../../placement/webgpuGrowth.ts`) start still beside the others, which keep their state,
     *  and so do they all when the table grows (`../row/grow.ts`): its row words are written anew. */
    ensure(placements: number, drawSlots: number, worldOf: (rank: number) => ArrayLike<number>) {
      if (moving.length === placements && rows.length === drawSlots) return;
      const kept = Math.min(moving.length, placements);
      const held = { moving, poses, lastMoved };
      if (moving.length !== placements) {
        // Every slot's followers are weighed again at its parent's next move (`moveLead`).
        leadMoving.fill(0);
        moving = new Uint8Array(placements);
        poses = new Float64Array(placements * 16);
        lastMoved = new Uint32Array(placements);
        moving.set(held.moving.subarray(0, kept));
        lastMoved.set(held.lastMoved.subarray(0, kept));
        movingList = [];
        for (let rank = 0; rank < kept; rank++) if (moving[rank]) movingList.push(rank);
        dirty = new Uint8Array(placements);
        dirtyList = dirtyList.filter((rank) => rank < placements);
        for (const rank of dirtyList) dirty[rank] = 1;
        indexStale = true;
        poses.set(held.poses.subarray(0, kept * 16));
        for (let rank = kept; rank < placements; rank++) poses.set(worldOf(rank), rank * 16);
      }
      if (rows.length === Math.max(1, drawSlots)) return;
      rows = new Uint32Array(Math.max(1, drawSlots));
      rowRank = new Int32Array(rows.length).fill(-1);
      indexStale = true;
      wholeRows = true;
    },
    /**
     * Placement `rank` was posed at `world`: it moved unless `world` is the pose it was last seen
     * at, or whatever its pose when `forced` — a node moved, or a pose `holds` already weighed as
     * a move (a row taken or parked where it stands is no move). A pose `holds` keeps is not
     * stored: the next one is weighed against the last move. Returns
     * `MOVE_NONE`, `MOVE_MOVING` — it was moving already, its static casters stay — or
     * `MOVE_PROMOTED`, its first move.
     */
    move(rank: number, world: ArrayLike<number>, forced = false) {
      if (rank < 0 || rank >= moving.length) return MOVE_PROMOTED;
      if (!forced && holds(rank, world)) return MOVE_NONE;
      poses.set(world, rank * 16);
      lastMoved[rank] = frame;
      if (moving[rank]) return MOVE_MOVING;
      promote(rank);
      return MOVE_PROMOTED;
    },
    /** Placement `rank` follows parent slot `lead` from now on, or none when -1. A still follower
     *  joining a slot is made moving at its parent's next move. */
    follow(rank: number, lead: number) {
      if (rank >= leads.length) {
        if (lead < 0) return;
        const held = leads;
        leads = new Int32Array(Math.max(rank + 1, 2 * held.length)).fill(-1);
        leads.set(held);
      }
      leads[rank] = lead;
      if (lead < 0) return;
      if (lead >= leadMoved.length) {
        const size = Math.max(lead + 1, 2 * leadMoved.length);
        const held = { leadMoved, leadMoving, leadDeclared };
        leadMoved = new Uint32Array(size);
        leadMoving = new Uint8Array(size);
        leadDeclared = new Uint32Array(size);
        leadMoved.set(held.leadMoved);
        leadMoving.set(held.leadMoving);
        leadDeclared.set(held.leadDeclared);
      }
      if (!(rank < moving.length && moving[rank])) leadMoving[lead] = 0;
    },
    /**
     * Parent slot `lead` moved: every placement of `ranks` that follows it moved with it, as one
     * `move` each would weigh it, without a pose per placement. Its first move makes its still
     * followers moving, once; a later one only stamps the slot's frame, which `settle` reads for
     * each follower. Returns `MOVE_PROMOTED` when a follower left the static slice, else
     * `MOVE_MOVING`.
     */
    moveLead(lead: number, ranks: readonly number[]) {
      if (lead < 0 || lead >= leadMoved.length) return MOVE_PROMOTED;
      leadMoved[lead] = frame;
      if (leadMoving[lead]) return MOVE_MOVING;
      let promoted = false;
      for (const rank of ranks) {
        if (rank >= moving.length || leads[rank] !== lead || moving[rank]) continue;
        promote(rank);
        promoted = true;
      }
      leadMoving[lead] = moving.length ? 1 : 0;
      return promoted ? MOVE_PROMOTED : MOVE_MOVING;
    },
    /**
     * One scene frame: every moving placement that has not moved for more than `threshold` frames
     * — itself, nor the parent slot it follows (`moveLead`) — turns static and is handed to
     * `turnedStatic`, which invalidates its static pages, so the static slice draws it. A follower
     * is handed with its slot, once a call for the slot: the slot's box holds every follower where
     * its parent now holds it, which the follower's own box, made at its last CPU pose, may not.
     * Its rows' words are written anew at the next `writeRows`, its rows alone. Walks the moving
     * placements only. Returns whether one did.
     */
    settle(threshold: number, turnedStatic: (rank: number, lead: number) => void) {
      frame = (frame + 1) >>> 0;
      let any = false;
      for (let k = movingList.length - 1; k >= 0; k--) {
        const rank = movingList[k],
          lead = rank < leads.length ? leads[rank] : -1;
        let rest = (frame - lastMoved[rank]) >>> 0;
        if (lead >= 0) rest = Math.min(rest, (frame - leadMoved[lead]) >>> 0);
        if (rest <= threshold) continue;
        moving[rank] = 0;
        movingList[k] = movingList[movingList.length - 1];
        movingList.pop();
        touch(rank);
        any = true;
        if (lead < 0) turnedStatic(rank, -1);
        else {
          leadMoving[lead] = 0;
          if (leadDeclared[lead] === frame) continue;
          leadDeclared[lead] = frame;
          turnedStatic(rank, lead);
        }
      }
      return any;
    },
    /** Placement `rank`'s rows must be written again: it starts or stops casting, or is parked
     *  or taken (`MOBILITY_SHADOWLESS`). */
    touch,
    /**
     * Writes the row words of rows `[from, to]` — every row on a new table — from each row's
     * placement, then the rows of every placement `touch`ed since (moving or static, casting or
     * not), and hands each written span to push. A row from `alwaysMoving` on is a blended
     * caster's: moving as its placement is. A row `cutout` says is filed with the casters drawn
     * with the fragment test (#965); a blended caster's never is: the transmittance pass reads the
     * other list alone. `corners` is the count a row draws, what its region's command is sized by
     * (#966). `shadowless` says a placement casts no shadow — `castShadow = false`, hidden or
     * parked: its rows carry `MOBILITY_SHADOWLESS`, which every caster pass skips.
     */
    writeRows(
      placementOf: (row: number) => number,
      rowCount: number,
      from: number,
      to: number,
      push: (first: number, count: number) => void,
      corners: (row: number) => number,
      alwaysMoving = rowCount,
      cutout: (row: number) => boolean = () => false,
      shadowless: (rank: number) => boolean = () => false,
    ) {
      if (wholeRows) {
        from = 0;
        to = rowCount - 1;
        wholeRows = false;
      }
      const last = Math.min(to, rows.length - 1);
      if (last >= from) {
        for (let row = from; row <= last; row++) {
          const placement = placementOf(row),
            blended = row >= alwaysMoving,
            flags =
              rankBits(placement, shadowless) | (!blended && cutout(row) ? MOBILITY_CUTOUT : 0),
            word = (corners(row) << MOBILITY_CORNER_SHIFT) | flags;
          if (rowRank[row] !== placement) {
            rowRank[row] = placement;
            indexStale = true;
          }
          rows[row] = word;
        }
        push(from, last - from + 1);
      }
      if (!dirtyList.length) return;
      if (indexStale) rebuildIndex();
      const kept = ~(MOBILITY_MOVING | MOBILITY_SHADOWLESS);
      for (const rank of dirtyList) {
        dirty[rank] = 0;
        const bits = rankBits(rank, shadowless);
        let runFirst = -1,
          runLast = -2;
        for (let k = indexStart[rank]; k < indexStart[rank + 1]; k++) {
          const row = indexRows[k],
            word = (rows[row] & kept) | bits;
          if (word === rows[row]) continue;
          rows[row] = word;
          if (row !== runLast + 1) {
            if (runFirst >= 0) push(runFirst, runLast - runFirst + 1);
            runFirst = row;
          }
          runLast = row;
        }
        if (runFirst >= 0) push(runFirst, runLast - runFirst + 1);
      }
      dirtyList.length = 0;
    },
  };
}

export type ShadowMobility = ReturnType<typeof createShadowMobility>;
