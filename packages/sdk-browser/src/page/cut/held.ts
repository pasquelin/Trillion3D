import type { ClusterRoot } from '../selection/types.ts';
import { createCutReadiness, type CutReadiness } from './readiness.ts';
import { linksFor } from './links.ts';
import { residentUnder, type PageRecord, type SelectionState } from './state.ts';

type Held = {
  readiness: CutReadiness;
  structure: ClusterRoot<unknown>['structure'];
  nodes: Float64Array | undefined;
  pages: number;
  /** The residency stamp the readiness was read under, 0 for none. */
  stamp: number;
};

/** One readiness per placement: its pages' residency is its own, its DAG shared. Its state is
 *  held for the placement's resident pages only (`./readiness.ts`), so the placements a cut walks
 *  cost what the pool holds of them, never their catalogue. */
const heldOf = new WeakMap<object, Held>();
/** Last residency stamp handed out. */
let lastStamp = 0;

/** A new residency stamp, never 0: cuts that pass it answer residency alike (`./cut.ts`). */
export function nextResidencyStamp() {
  lastStamp = (lastStamp + 1) >>> 0 || 1;
  return lastStamp;
}

/** What a total's `track` hands each placement it counts: the total, until it tracks again. The
 *  placements keep only this, so a total never keeps alive the placements it let go of. */
type Ticket = { tally: HeldBytes | undefined };
/** The running total each placement adds its readiness's change of bytes to (`createHeldBytes`). */
const tallyOf = new WeakMap<object, Ticket>();
/** Adds `bytes` to the total counting `root`, when one does. */
const tallyBytes = (root: object, bytes: number) => {
  const tally = tallyOf.get(root)?.tally;
  if (tally) tally.bytes += bytes;
};

/**
 * The cut rule's residency for `root` this cut (`./readiness.ts`), from what the cut's residency
 * rule answers for each of its pages. Kept per placement from one cut to the next, so only the
 * pages whose residency moved propagate; a placement whose DAG or hierarchy changed starts over.
 * A cut of the stamp the readiness was read under reads nothing again: nothing moved since.
 */
export function heldReadiness<T extends PageRecord>(s: SelectionState<T>, root: ClusterRoot<T>) {
  const pages = root.pages,
    culling = root.culling;
  let held = heldOf.get(root);
  if (
    !held ||
    held.structure !== root.structure ||
    held.nodes !== culling?.nodes ||
    held.pages !== pages.length
  ) {
    const links = culling && linksFor(culling, pages.length);
    // The state it replaces leaves the total with it.
    if (held) tallyBytes(root, -held.readiness.hostBytes);
    held = {
      readiness: createCutReadiness(root.structure, links),
      structure: root.structure,
      nodes: culling?.nodes,
      pages: pages.length,
      stamp: 0,
    };
    heldOf.set(root, held);
  }
  const { readiness } = held,
    mode = s.residentMode;
  if (s.residencyStamp && held.stamp === s.residencyStamp) return readiness;
  held.stamp = s.residencyStamp;
  for (let page = 0; page < pages.length; page++)
    readiness.set(page, residentUnder(s, pages[page], mode));
  const moved = readiness.settle();
  if (moved) tallyBytes(root, moved);
  return readiness;
}

type HeldBytes = ReturnType<typeof createHeldBytes>;

/**
 * The bytes of the readiness state of a set of placements, those no cut has read counting none,
 * kept as a running total: each cut that settles one of them adds what its state gained or lost,
 * so `bytes` is read without walking the placements (#483 rule 7). `track` names the placements
 * it counts, walking them once: called again when they change, it lets go of those that left. A
 * placement is counted by the last total that tracked it.
 */
export function createHeldBytes() {
  let ticket: Ticket = { tally: undefined };
  const tally = {
    bytes: 0,
    track(roots: readonly object[]) {
      ticket.tally = undefined;
      ticket = { tally };
      tally.bytes = 0;
      for (const root of roots) {
        tallyOf.set(root, ticket);
        tally.bytes += heldOf.get(root)?.readiness.hostBytes ?? 0;
      }
    },
  };
  return tally;
}
