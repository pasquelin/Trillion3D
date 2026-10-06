import { MOVE_MOVING, MOVE_NONE, MOVE_PROMOTED } from '../../placement/update.ts';
import { holdsPose, promoteRank, touchRank, type MobilityState } from './mobilityState.ts';

/**
 * Placement `rank` was posed at `world`: it moved unless `world` is the pose it was last seen
 * at, or whatever its pose when `forced` — a node moved, or a pose `holds` already weighed as
 * a move (a row taken or parked where it stands is no move). A pose `holds` keeps is not
 * stored: the next one is weighed against the last move. Returns
 * `MOVE_NONE`, `MOVE_MOVING` — it was moving already, its static casters stay — or
 * `MOVE_PROMOTED`, its first move.
 */
export function moveRank(
  s: MobilityState,
  rank: number,
  world: ArrayLike<number>,
  forced: boolean,
) {
  if (rank < 0 || rank >= s.moving.length) return MOVE_PROMOTED;
  if (!forced && holdsPose(s, rank, world)) return MOVE_NONE;
  s.poses.set(world, rank * 16);
  s.lastMoved[rank] = s.frame;
  if (s.moving[rank]) return MOVE_MOVING;
  promoteRank(s, rank);
  return MOVE_PROMOTED;
}

/** Placement `rank` follows parent slot `lead` from now on, or none when -1. A still follower
 *  joining a slot is made moving at its parent's next move. */
export function followLead(s: MobilityState, rank: number, lead: number) {
  if (rank >= s.leads.length) {
    if (lead < 0) return;
    const held = s.leads;
    s.leads = new Int32Array(Math.max(rank + 1, 2 * held.length)).fill(-1);
    s.leads.set(held);
  }
  s.leads[rank] = lead;
  if (lead < 0) return;
  if (lead >= s.leadMoved.length) growSlots(s, Math.max(lead + 1, 2 * s.leadMoved.length));
  if (!(rank < s.moving.length && s.moving[rank])) s.leadMoving[lead] = 0;
}

/** The per-slot arrays hold `size` slots, the ones they held kept. */
function growSlots(s: MobilityState, size: number) {
  const held = { leadMoved: s.leadMoved, leadMoving: s.leadMoving, leadDeclared: s.leadDeclared };
  s.leadMoved = new Uint32Array(size);
  s.leadMoving = new Uint8Array(size);
  s.leadDeclared = new Uint32Array(size);
  s.leadMoved.set(held.leadMoved);
  s.leadMoving.set(held.leadMoving);
  s.leadDeclared.set(held.leadDeclared);
}

/**
 * Parent slot `lead` moved: every placement of `ranks` that follows it moved with it, as one
 * `move` each would weigh it, without a pose per placement. Its first move makes its still
 * followers moving, once; a later one only stamps the slot's frame, which `settle` reads for
 * each follower. Returns `MOVE_PROMOTED` when a follower left the static slice, else
 * `MOVE_MOVING`.
 */
export function moveLeadSlot(s: MobilityState, lead: number, ranks: readonly number[]) {
  if (lead < 0 || lead >= s.leadMoved.length) return MOVE_PROMOTED;
  s.leadMoved[lead] = s.frame;
  if (s.leadMoving[lead]) return MOVE_MOVING;
  let promoted = false;
  for (const rank of ranks) {
    if (rank >= s.moving.length || s.leads[rank] !== lead || s.moving[rank]) continue;
    promoteRank(s, rank);
    promoted = true;
  }
  s.leadMoving[lead] = s.moving.length ? 1 : 0;
  return promoted ? MOVE_PROMOTED : MOVE_MOVING;
}

/**
 * One scene frame: every moving placement that has not moved for more than `threshold` frames
 * — itself, nor the parent slot it follows (`moveLead`) — turns static and is handed to
 * `turnedStatic`, which invalidates its static pages, so the static slice draws it. A follower
 * is handed with its slot, once a call for the slot: the slot's box holds every follower where
 * its parent now holds it, which the follower's own box, made at its last CPU pose, may not.
 * Its rows' words are written anew at the next `writeRows`, its rows alone. Walks the moving
 * placements only. Returns whether one did.
 */
export function settleMoving(
  s: MobilityState,
  threshold: number,
  turnedStatic: (rank: number, lead: number) => void,
) {
  s.frame = (s.frame + 1) >>> 0;
  const frame = s.frame,
    list = s.movingList;
  let any = false;
  for (let k = list.length - 1; k >= 0; k--) {
    const rank = list[k],
      lead = rank < s.leads.length ? s.leads[rank] : -1;
    let rest = (frame - s.lastMoved[rank]) >>> 0;
    if (lead >= 0) rest = Math.min(rest, (frame - s.leadMoved[lead]) >>> 0);
    if (rest <= threshold) continue;
    s.moving[rank] = 0;
    list[k] = list[list.length - 1];
    list.pop();
    touchRank(s, rank);
    any = true;
    if (lead < 0) turnedStatic(rank, -1);
    else {
      s.leadMoving[lead] = 0;
      if (s.leadDeclared[lead] === frame) continue;
      s.leadDeclared[lead] = frame;
      turnedStatic(rank, lead);
    }
  }
  return any;
}
