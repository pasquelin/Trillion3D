import type { ClusterStructureIndex } from '../selection/types.ts';
import { createSparseInts } from './sparseInts.ts';
import { baseOpen, type CullingLinks } from './links.ts';

/**
 * THE RESIDENCY THE CUT RULE READS (`./rule.ts`), derived from the per-cluster residency of one
 * placement and its group links. One definition: the GPU kernel's host derives it
 * (`../../gpu/dag/readiness.ts`), the CPU cut reads it (`./held.ts`).
 *
 * A group is READY when every cluster it replaces is resident and every group that replaces its
 * outputs is ready — a cluster nothing replaces standing for itself. Readiness is therefore closed
 * upward: a ready group has ready ancestors, whatever order pages arrived or left in. For a cluster:
 *
 * - `isReady` (the rule's `resident(c)`): its own group is ready, or, nothing replacing it, it is
 *   resident itself;
 * - `isChildReady` (the rule's `resident(childGroup(c))`): the group that produced it is ready; a
 *   cluster nothing produced has no finer group, and reads ready.
 *
 * With the rule, a group then draws either all its outputs or all its members, never both and
 * never neither: every surface is drawn exactly once, by its nearest resident representation.
 *
 * `openAt(node)` counts the clusters under a culling node whose finer group is not ready: the only
 * clusters the rule may draw with an error above the threshold. A node whose error floor is above
 * the threshold is dropped only when that count is zero (`../../gpu/dag/shader/floorWgsl.ts`).
 *
 * Bounded by the view, not the catalogue (#483 rule 6): the state is held for the resident pages
 * only — the resident set, the ready groups (all of whose members are resident), and per node how
 * many of its clusters a ready group produced. Every other page and node reads its value with
 * nothing resident, derived from the DAG: its open count is the DAG's own (`baseOpen`), shared by
 * every placement of it.
 *
 * A placement without group links has no replacement to name: each cluster stands for itself.
 */
export type CutReadiness = ReturnType<typeof createCutReadiness>;

/** What `writeOpen` targets between calls: nothing. */
const NO_OUT = new Int32Array(0);

/** Where `writeOpen` writes, read by one callback built once: a walk allocates nothing. */
const opened = { out: NO_OUT as Int32Array | Uint32Array, count: 0 };
const openNode = (node: number, value: number) => {
  if (node < opened.count) opened.out[node] -= value;
};

/** What one readiness holds between calls, the state its propagation reads and writes. */
type SparseInts = ReturnType<typeof createSparseInts>;

interface ReadinessState {
  resident: SparseInts;
  groupReady: SparseInts;
  /** Per node, its clusters whose finer group is ready: what `openAt` takes off `baseOpen`. */
  closed: SparseInts;
  pending: number[];
  work: number[];
  touchedPages: number[];
  touchedNodes: number[];
}

/** A cluster's finer group became ready (`step` 1) or unready (-1): its nodes close or open. */
function markNodes(
  links: CullingLinks | undefined,
  state: ReadinessState,
  page: number,
  step: number,
) {
  let node = links ? links.leafOfPage[page] : -1;
  while (node >= 0) {
    state.closed.add(node, step);
    state.touchedNodes.push(node);
    node = links!.parents[node];
  }
}

/** Group `g` from what it reads: its members' residency and its outputs' own groups. */
function groupOf(structure: ClusterStructureIndex, state: ReadinessState, g: number) {
  const s = structure;
  for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++)
    if (!state.resident.get(s.children[i])) return 0;
  for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
    const output = s.outputs[i],
      owner = s.owners[output];
    if (owner < 0 ? !state.resident.get(output) : !state.groupReady.get(owner)) return 0;
  }
  return 1;
}

/** Seeds the worklist from the pages `set` recorded and settles it on a fixed point. */
function propagate(
  structure: ClusterStructureIndex | undefined,
  links: CullingLinks | undefined,
  state: ReadinessState,
) {
  const { pending, work, touchedPages, groupReady } = state;
  for (const page of pending) {
    const owner = structure ? structure.owners[page] : -1,
      source = structure ? structure.sources[page] : -1;
    if (owner >= 0) work.push(owner);
    else {
      touchedPages.push(page);
      if (source >= 0) work.push(source);
    }
  }
  // Readiness only flows DOWN the DAG, from a group to those that produced its members: the
  // worklist settles on a fixed point, the DAG having no cycle.
  while (work.length) {
    const g = work.pop()!,
      value = groupOf(structure!, state, g),
      s = structure!;
    if (groupReady.set(g, value) === value) continue;
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++) {
      const member = s.children[i];
      touchedPages.push(member);
      if (s.sources[member] >= 0) work.push(s.sources[member]);
    }
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      touchedPages.push(s.outputs[i]);
      markNodes(links, state, s.outputs[i], value ? 1 : -1);
    }
  }
  pending.length = 0;
}

/** The rule's `resident(c)`: the cluster's own group is ready, or, nothing replacing it, it is
 *  resident itself. */
function isReadyIn(
  structure: ClusterStructureIndex | undefined,
  state: ReadinessState,
  page: number,
) {
  const owner = structure ? structure.owners[page] : -1;
  return owner >= 0 ? state.groupReady.get(owner) !== 0 : state.resident.get(page) !== 0;
}

/** The rule's `resident(childGroup(c))`: the group that produced the cluster is ready. */
function isChildReadyIn(
  structure: ClusterStructureIndex | undefined,
  state: ReadinessState,
  page: number,
) {
  const source = structure ? structure.sources[page] : -1;
  return source < 0 || state.groupReady.get(source) !== 0;
}

/** Writes the first `count` open counts into `out`: the base counts less the closed ones. */
function writeOpenCounts(
  base: Int32Array | Uint32Array | undefined,
  closed: SparseInts,
  out: Int32Array | Uint32Array,
  count: number,
) {
  if (!base) return void out.fill(0, 0, count);
  out.set(base.subarray(0, count));
  opened.out = out;
  opened.count = count;
  closed.forEach(openNode);
  // The caller's view (the walk's WebAssembly memory) is not kept past the call.
  opened.out = NO_OUT;
  opened.count = 0;
}

export function createCutReadiness(
  structure: ClusterStructureIndex | undefined,
  links: CullingLinks | undefined,
) {
  const state: ReadinessState = {
    resident: createSparseInts(),
    groupReady: createSparseInts(),
    closed: createSparseInts(),
    pending: [],
    work: [],
    touchedPages: [],
    touchedNodes: [],
  };
  const { resident, groupReady, closed, pending, touchedPages, touchedNodes } = state;
  const base = structure && links ? baseOpen(links, structure) : undefined;
  const bytes = () => resident.byteLength + groupReady.byteLength + closed.byteLength;
  /** The bytes the last `settle` handed over. */
  let reported = 0;
  const isReady = (page: number) => isReadyIn(structure, state, page);
  const isChildReady = (page: number) => isChildReadyIn(structure, state, page);
  const openAt = (node: number) => (base ? base[node] - closed.get(node) : 0);
  return {
    isReady,
    isChildReady,
    openAt,
    /** Writes the first `count` open counts into `out`: a walk that reads them densely. */
    writeOpen: (out: Int32Array | Uint32Array, count: number) =>
      writeOpenCounts(base, closed, out, count),
    /** Bytes of the state: what the resident pages hold, never the catalogue. */
    get hostBytes() {
      return bytes();
    },
    /** True when nothing is resident and nothing is pending: the state reads as one just made. */
    get holdsNothing() {
      return !pending.length && !resident.size && !groupReady.size && !closed.size;
    },
    /** Records page `page`'s residency; `settle` propagates it. True when it changed. */
    set(page: number, value: boolean) {
      if (resident.set(page, value ? 1 : 0) === (value ? 1 : 0)) return false;
      pending.push(page);
      return true;
    },
    /** Propagates what `set` recorded, then hands over the pages whose `isReady` or
     *  `isChildReady` changed and the nodes whose `openAt` changed, each possibly more than once:
     *  from the state with nothing resident, which a reader derives from the accessors. Returns
     *  what `hostBytes` gained, or lost when negative, since the last settle: what a running total
     *  of many readinesses adds, so that it is read without walking them (#483 rule 7). */
    settle(onPage?: (page: number) => void, onNode?: (node: number) => void) {
      propagate(structure, links, state);
      if (onPage) for (const page of touchedPages) onPage(page);
      if (onNode) for (const node of touchedNodes) onNode(node);
      touchedPages.length = 0;
      touchedNodes.length = 0;
      const now = bytes(),
        moved = now - reported;
      reported = now;
      return moved;
    },
  };
}
