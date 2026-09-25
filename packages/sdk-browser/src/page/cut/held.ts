import type { ClusterRoot } from '../selection/types.ts';
import { createCutReadiness, cullingLinks, type CullingLinks } from './readiness.ts';
import { residentUnder, type PageRecord, type SelectionState } from './state.ts';

type Held = {
  readiness: ReturnType<typeof createCutReadiness>;
  structure: ClusterRoot<unknown>['structure'];
  nodes: Float64Array | undefined;
  pages: number;
};

/** One readiness per placement: its pages' residency is its own, its DAG shared. */
const heldOf = new WeakMap<object, Held>();
/** Links derived for a hierarchy collected without them, shared by its placements. */
const linksOf = new WeakMap<Float64Array, CullingLinks>();

function linksFor(culling: NonNullable<ClusterRoot<unknown>['culling']>, pages: number) {
  if (culling.links) return culling.links;
  let links = linksOf.get(culling.nodes);
  if (!links) linksOf.set(culling.nodes, (links = cullingLinks(culling, pages)));
  return links;
}

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
    const nodeCount = culling ? Math.floor(culling.nodes.length / culling.stride) : 0;
    held = {
      readiness: createCutReadiness(root.structure, links, pages.length, nodeCount),
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
