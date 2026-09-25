import type { ClusterStructureIndex } from '../selection/types.ts';

/**
 * THE RESIDENCY THE CUT RULE READS (`./rule.ts`), derived from the per-cluster residency of one
 * placement and its group links. One definition: the GPU kernel's host derives it
 * (`../../gpu/dag/readiness.ts`), and its CPU model reads what it derived.
 *
 * A group is READY when every cluster it replaces is resident and every group that replaces its
 * outputs is ready — a cluster nothing replaces standing for itself. Readiness is therefore closed
 * upward: a ready group has ready ancestors, whatever order pages arrived or left in. For a cluster:
 *
 * - `ready` (the rule's `resident(c)`): its own group is ready, or, nothing replacing it, it is
 *   resident itself;
 * - `childReady` (the rule's `resident(childGroup(c))`): the group that produced it is ready; a
 *   cluster nothing produced has no finer group, and reads ready.
 *
 * With the rule, a group then draws either all its outputs or all its members, never both and
 * never neither: every surface is drawn exactly once, by its nearest resident representation.
 *
 * `open[node]` counts the clusters under a culling node whose finer group is not ready: the only
 * clusters the rule may draw with an error above the threshold. A node whose error floor is above
 * the threshold is dropped only when that count is zero (`../../gpu/dag/shader/floorWgsl.ts`).
 *
 * A placement without group links has no replacement to name: each cluster stands for itself.
 */
export function createCutReadiness(
  structure: ClusterStructureIndex | undefined,
  links: CullingLinks | undefined,
  pageCount: number,
  nodeCount: number,
  /** Where the state lives: views into a caller's wider arrays, or fresh ones. */
  into?: { ready: Uint8Array; childReady: Uint8Array; open: Int32Array },
) {
  const resident = new Uint8Array(pageCount),
    ready = into?.ready ?? new Uint8Array(pageCount),
    childReady = into?.childReady ?? new Uint8Array(pageCount),
    open = into?.open ?? new Int32Array(nodeCount),
    groupReady = new Uint8Array(structure?.groupCount ?? 0),
    pending: number[] = [],
    work: number[] = [];
  const touchedPages: number[] = [],
    touchedNodes: number[] = [];
  /** Until the first `settle`, every page and every counted node is new: they are handed over
   *  whole then, rather than logged one change at a time. */
  let fresh = true;
  const mark = (page: number, delta: number) => {
    let node = links ? links.leafOfPage[page] : -1;
    while (node >= 0) {
      open[node] += delta;
      if (!fresh) touchedNodes.push(node);
      node = links!.parents[node];
    }
  };
  const setChildReady = (page: number, value: number) => {
    if (childReady[page] === value) return;
    childReady[page] = value;
    if (!fresh) touchedPages.push(page);
    mark(page, value ? -1 : 1);
  };
  const setReady = (page: number, value: number) => {
    if (ready[page] === value) return;
    ready[page] = value;
    if (!fresh) touchedPages.push(page);
  };
  // Nothing is resident yet.
  ready.fill(0);
  open.fill(0);
  childReady.fill(1);
  if (structure)
    for (let page = 0; page < pageCount; page++)
      if (structure.sources[page] >= 0) setChildReady(page, 0);
  /** Group `g` from what it reads: its members' residency and its outputs' own groups. */
  const groupOf = (g: number) => {
    const s = structure!;
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++)
      if (!resident[s.children[i]]) return 0;
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const output = s.outputs[i],
        owner = s.owners[output];
      if (owner < 0 ? !resident[output] : !groupReady[owner]) return 0;
    }
    return 1;
  };
  return {
    ready,
    childReady,
    open,
    /** Bytes this readiness allocated itself; views it was handed are its caller's to count. */
    hostBytes: [resident, groupReady, ...(into ? [] : [ready, childReady, open])].reduce(
      (bytes, table) => bytes + table.byteLength,
      0,
    ),
    /** Records page `page`'s residency; `settle` propagates it. */
    set(page: number, value: boolean) {
      const bit = value ? 1 : 0;
      if (resident[page] === bit) return;
      resident[page] = bit;
      pending.push(page);
    },
    /** Propagates what `set` recorded, then hands over the pages whose `ready` or `childReady`
     *  changed and the nodes whose `open` count changed, each possibly more than once. */
    settle(onPage?: (page: number) => void, onNode?: (node: number) => void) {
      if (!structure) for (const page of pending) setReady(page, resident[page]);
      else {
        for (const page of pending) {
          const owner = structure.owners[page],
            source = structure.sources[page];
          if (owner >= 0) work.push(owner);
          else {
            setReady(page, resident[page]);
            if (source >= 0) work.push(source);
          }
        }
        // Readiness only flows DOWN the DAG, from a group to those that produced its members: the
        // worklist settles on a fixed point, the DAG having no cycle.
        while (work.length) {
          const g = work.pop()!,
            value = groupOf(g);
          if (groupReady[g] === value) continue;
          groupReady[g] = value;
          for (let i = structure.childOffsets[g]; i < structure.childOffsets[g + 1]; i++) {
            const member = structure.children[i];
            setReady(member, value);
            if (structure.sources[member] >= 0) work.push(structure.sources[member]);
          }
          for (let i = structure.outputOffsets[g]; i < structure.outputOffsets[g + 1]; i++)
            setChildReady(structure.outputs[i], value);
        }
      }
      pending.length = 0;
      if (fresh) {
        fresh = false;
        for (let page = 0; page < pageCount && onPage; page++) onPage(page);
        for (let node = 0; node < nodeCount && onNode; node++) if (open[node]) onNode(node);
        return;
      }
      if (onPage) for (const page of touchedPages) onPage(page);
      if (onNode) for (const node of touchedNodes) onNode(node);
      touchedPages.length = 0;
      touchedNodes.length = 0;
    },
  };
}

/**
 * Upward links of the culling hierarchy: each node's parent, each cluster's leaf node. The DAG's
 * shape depends on no world matrix: these two arrays are computed once per primitive and shared
 * by all of its instances.
 *
 * They carry a cluster's readiness up to the nodes that hold it (`open`), without sweeping a
 * subtree.
 */
export type CullingLinks = { parents: Int32Array; leafOfPage: Int32Array };

export function cullingLinks(
  { nodes, stride }: { nodes: Float64Array; stride: number },
  pages: number,
): CullingLinks {
  const count = (nodes.length / stride) | 0;
  const parents = new Int32Array(count).fill(-1),
    leafOfPage = new Int32Array(pages).fill(-1);
  for (let node = 0; node < count; node++) {
    const base = node * stride,
      children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      for (let child = 0; child < children; child++) parents[first + child] = node;
      continue;
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    for (let i = 0; i < pageCount; i++) leafOfPage[firstPage + i] = node;
  }
  return { parents, leafOfPage };
}
