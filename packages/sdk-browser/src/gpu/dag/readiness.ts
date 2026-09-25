import { createCutReadiness } from '../../page/cut/readiness.ts';
import type { ResidencyChanges } from '../core/selection.ts';
import type { PackedDag } from './types.ts';
import { DAG_NODE_FLOATS } from './types.ts';
import { NODE_OPEN } from './packNodes.ts';

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
  const worlds = packed.cutLinks.map((l) =>
    createCutReadiness(l.structure, l.links),
  );
  /** Placements `set` touched since the last settle. */
  const dirty = new Set<number>();
  const pages: number[] = [],
    nodes: number[] = [];
  let w = 0;
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
    for (const touched of dirty) worlds[(w = touched)].settle(onPage, onNode);
    dirty.clear();
    return { pages: sortedUnique(pages), nodes: sortedUnique(nodes) };
  };
  const set = (page: number, value: boolean) => {
    const at = pageWorlds[page];
    if (worlds[at].set(page - packed.cutLinks[at].pageBase, value)) dirty.add(at);
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
    /** Bytes of the host tables: each placement's state, sized by its resident pages. */
    get hostBytes() {
      return worlds.reduce((bytes, world) => bytes + world.hostBytes, 0);
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
