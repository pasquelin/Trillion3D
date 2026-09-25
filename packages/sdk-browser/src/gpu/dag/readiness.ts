import { createCutReadiness } from '../../page/cut/readiness.ts';
import type { ResidencyChanges } from '../core/selection.ts';
import type { PackedDag } from './types.ts';
import { DAG_NODE_FLOATS } from './types.ts';
import { NODE_OPEN } from './packNodes.ts';

/**
 * The cut rule's residency over a whole packing: one `createCutReadiness` per placement, its state
 * held in views of catalogue-wide arrays so a page's `ready`, `childReady` and a node's `open` are
 * read at their packed index. The kernel's host feeds it the per-page residency and uploads what
 * changed (`runtime.ts`); the CPU model reads the same arrays (`oracle/oracle.ts`).
 *
 * Each node's `open` count is also written into the packed nodes, at the word the kernel reads
 * (`NODE_OPEN`): the host copy of the node buffer stays the one the oracle reads.
 */
export function createDagReadiness(packed: PackedDag) {
  const ready = new Uint8Array(packed.pageCount),
    childReady = new Uint8Array(packed.pageCount),
    open = new Int32Array(Math.max(1, packed.nodeCount)),
    nodeInts = new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset, packed.nodes.length),
    pageWorlds = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCount,
    );
  const worlds = packed.cutLinks.map((l) =>
    createCutReadiness(l.structure, l.links, l.pageCount, l.nodeCount, {
      ready: ready.subarray(l.pageBase, l.pageBase + l.pageCount),
      childReady: childReady.subarray(l.pageBase, l.pageBase + l.pageCount),
      open: open.subarray(l.nodeBase, l.nodeBase + l.nodeCount),
    }),
  );
  const dirty = new Uint8Array(Math.max(1, worlds.length));
  const pages: number[] = [],
    nodes: number[] = [];
  let pageBase = 0,
    nodeBase = 0;
  const onPage = (page: number) => pages.push(pageBase + page),
    onNode = (node: number) => {
      const at = nodeBase + node;
      nodeInts[at * DAG_NODE_FLOATS + NODE_OPEN] = open[at];
      nodes.push(at);
    };
  /** Settles every placement `set` touched; returns the sorted, repeat-free packed pages whose
   *  `ready` or `childReady` changed and nodes whose `open` changed. */
  const settle = () => {
    pages.length = 0;
    nodes.length = 0;
    for (let w = 0; w < worlds.length; w++) {
      if (!dirty[w]) continue;
      dirty[w] = 0;
      pageBase = packed.cutLinks[w].pageBase;
      nodeBase = packed.cutLinks[w].nodeBase;
      worlds[w].settle(onPage, onNode);
    }
    return { pages: sortedUnique(pages), nodes: sortedUnique(nodes) };
  };
  const set = (page: number, value: boolean) => {
    const w = pageWorlds[page],
      links = packed.cutLinks[w];
    worlds[w].set(page - links.pageBase, value);
    dirty[w] = 1;
  };
  // Nothing is resident yet: every placement settles its initial state once, over nodes that
  // hold no count until then.
  for (let n = 0; n < packed.nodeCount; n++) nodeInts[n * DAG_NODE_FLOATS + NODE_OPEN] = 0;
  dirty.fill(1);
  return {
    ready,
    childReady,
    /** Reads `resident` at the pages `changes` names — every page when it names none reliably —,
     *  and settles. */
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
