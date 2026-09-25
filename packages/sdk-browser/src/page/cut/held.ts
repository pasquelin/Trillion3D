import type { ClusterRoot } from '../selection/types.ts';
import { createCutReadiness, type CutReadiness } from './readiness.ts';
import { linksFor } from './links.ts';
import { residentUnder, type PageRecord, type SelectionState } from './state.ts';

type Held = {
  readiness: CutReadiness;
  structure: ClusterRoot<unknown>['structure'];
  nodes: Float64Array | undefined;
  pages: number;
};

/** One readiness per placement: its pages' residency is its own, its DAG shared. Its state is
 *  held for the placement's resident pages only (`./readiness.ts`), so the placements a cut walks
 *  cost what the pool holds of them, never their catalogue. */
const heldOf = new WeakMap<object, Held>();

/**
 * The cut rule's residency for `root` this cut (`./readiness.ts`), from what the cut's residency
 * rule answers for each of its pages. Kept per placement from one cut to the next, so only the
 * pages whose residency moved propagate; a placement whose DAG or hierarchy changed starts over.
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
    held = {
      readiness: createCutReadiness(root.structure, links),
      structure: root.structure,
      nodes: culling?.nodes,
      pages: pages.length,
    };
    heldOf.set(root, held);
  }
  const { readiness } = held,
    mode = s.residentMode;
  for (let page = 0; page < pages.length; page++)
    readiness.set(page, residentUnder(s, pages[page], mode));
  readiness.settle();
  return readiness;
}

/** Bytes of the readiness state of `roots`, those no cut has read counting none. */
export const heldHostBytes = (roots: readonly object[]) =>
  roots.reduce((bytes: number, root) => bytes + (heldOf.get(root)?.readiness.hostBytes ?? 0), 0);
