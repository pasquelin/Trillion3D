import { createCutReadiness, type CutReadiness } from '../../page/cut/readiness.ts';
import type { ResidencyChanges } from '../core/selection.ts';
import type { CullingLinks } from '../../page/cut/links.ts';
import type { DagCutLinks, PackedDag } from './types.ts';
import { DAG_NODE_FLOATS } from './types.ts';
import { NODE_OPEN } from './nodeLayout.ts';

/**
 * The cut rule's residency over a whole packing: one `createCutReadiness` per placement, read at
 * its packed index. The kernel's host feeds it the per-page residency and uploads what changed
 * (`residencyUpload.ts`), whose bit sets are then the only dense copy of it.
 *
 * Each node's `open` count is written into the packed nodes, at the word the kernel reads
 * (`NODE_OPEN`): the host copy of the node buffer stays the one the oracle reads. The state itself
 * is held for the resident pages only (`../../page/cut/readiness.ts`, #483 rule 6).
 */
export function createDagReadiness(packed: PackedDag) {
  const nodeInts = new Uint32Array(
      packed.nodes.buffer,
      packed.nodes.byteOffset,
      packed.nodes.length,
    ),
    pageWorlds = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCount,
    );
  // A placement holds its own state only while one of its pages is resident: otherwise it reads
  // its primitive's state with nothing resident, one shared by every placement of the primitive
  // (Nanite's instances read their resource's pages, they hold none). The heap thus follows what
  // is resident, never the placement count (#1235, #483 rule 6).
  const blank = new Map<CullingLinks, Map<DagCutLinks['structure'], CutReadiness>>();
  const blankOf = ({ structure, links }: DagCutLinks) => {
    let byStructure = blank.get(links);
    if (!byStructure) blank.set(links, (byStructure = new Map()));
    let shared = byStructure.get(structure);
    if (!shared) byStructure.set(structure, (shared = createCutReadiness(structure, links)));
    return shared;
  };
  const worlds: CutReadiness[] = packed.cutLinks.map(blankOf);
  const held = new Uint8Array(packed.cutLinks.length);
  let heldCount = 0;
  const own = (at: number) => {
    if (!held[at]) {
      held[at] = 1;
      heldCount++;
      worlds[at] = createCutReadiness(packed.cutLinks[at].structure, packed.cutLinks[at].links);
    }
    return worlds[at];
  };
  /** Placements `set` touched since the last settle. */
  const dirty = new Set<number>();
  const pages: number[] = [],
    nodes: number[] = [];
  let w = 0,
    /** Every placement's `hostBytes`, kept as a running total: each settle adds what moved. */
    hostBytes = 0;
  const onPage = (page: number) => pages.push(packed.cutLinks[w].pageBase + page),
    onNode = (node: number) => {
      const at = packed.cutLinks[w].nodeBase + node;
      nodeInts[at * DAG_NODE_FLOATS + NODE_OPEN] = worlds[w].openAt(node);
      nodes.push(at);
    };
  /** Settles every placement `set` touched; returns the sorted, repeat-free packed pages whose
   *  readiness changed and nodes whose `open` changed. */
  const settle = () => {
    pages.length = 0;
    nodes.length = 0;
    for (const touched of dirty) {
      const world = worlds[(w = touched)];
      hostBytes += world.settle(onPage, onNode);
      // Its last page left: it reads the shared state again, which holds the same values.
      if (world.holdsNothing) {
        hostBytes -= world.hostBytes;
        worlds[touched] = blankOf(packed.cutLinks[touched]);
        held[touched] = 0;
        heldCount--;
      }
    }
    dirty.clear();
    return { pages: sortedUnique(pages), nodes: sortedUnique(nodes) };
  };
  const set = (page: number, value: boolean) => {
    const at = pageWorlds[page];
    if (!value && !held[at]) return;
    if (own(at).set(page - packed.cutLinks[at].pageBase, value)) dirty.add(at);
  };
  // Nothing is resident yet: each node holds its DAG's own open count, and only what then moves
  // is ever handed over.
  for (let n = 0; n < packed.nodeCount; n++) nodeInts[n * DAG_NODE_FLOATS + NODE_OPEN] = 0;
  worlds.forEach((world, at) => {
    const { nodeBase, nodeCount } = packed.cutLinks[at];
    for (let n = 0; n < nodeCount; n++)
      nodeInts[(nodeBase + n) * DAG_NODE_FLOATS + NODE_OPEN] = world.openAt(n);
  });
  return {
    /** The rule's `resident(c)` and `resident(childGroup(c))` of packed page `page`. */
    isReady(page: number) {
      const at = pageWorlds[page];
      return worlds[at].isReady(page - packed.cutLinks[at].pageBase);
    },
    isChildReady(page: number) {
      const at = pageWorlds[page];
      return worlds[at].isChildReady(page - packed.cutLinks[at].pageBase);
    },
    /** Whether packed page `page` is the finest representation its residency holds. */
    isFinest(page: number) {
      const at = pageWorlds[page];
      return worlds[at].isFinest(page - packed.cutLinks[at].pageBase);
    },
    /** The placements holding a state of their own: those a page of which is resident. */
    get heldPlacements() {
      return heldCount;
    },
    /** Bytes of the host tables: each placement's state, sized by its resident pages. Read in
     *  constant time, whatever the number of placements (#483 rule 7). */
    get hostBytes() {
      return hostBytes;
    },
    /** Reads `resident` at the pages `changes` names — every page when it names none reliably —,
     *  and settles: what is handed over is what moved from the state with nothing resident. */
    apply(resident: ArrayLike<number>, changes?: ResidencyChanges) {
      if (changes?.sorted)
        for (let i = 0; i < changes.count; i++) set(changes.pages[i], !!resident[changes.pages[i]]);
      else for (let page = 0; page < packed.pageCount; page++) set(page, !!resident[page]);
      return settle();
    },
  };
}

function sortedUnique(values: number[]) {
  values.sort((a, b) => a - b);
  let count = 0;
  for (let i = 0; i < values.length; i++)
    if (i === 0 || values[i] !== values[i - 1]) values[count++] = values[i];
  values.length = count;
  return values;
}
