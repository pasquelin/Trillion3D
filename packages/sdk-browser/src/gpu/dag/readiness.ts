import { createCutReadiness, type CutReadiness } from '../../page/cut/readiness.ts'
import type { ResidencyChanges } from '../core/selection.ts'
import type { CullingLinks } from '../../page/cut/links.ts'
import type { DagCutLinks, PackedDag } from './types.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import { NODE_OPEN } from './nodeLayout.ts'
import { uniqueSortedInPlace } from '../../../../math/src/scalar/integers.ts'

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
  const r: Readiness = {
    packed,
    nodeInts: new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset, packed.nodes.length),
    pageWorlds: new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCount,
    ),
    ...{ blank: new Map(), worlds: [] },
    // Sized for the packing's placements, the live ones and those a growth appends (`append`).
    held: new Uint8Array(Math.max(packed.worldCount, packed.cutLinks.length)),
    dirty: new Set(),
    ...{ heldCount: 0, pages: [], nodes: [], w: 0, hostBytes: 0 },
    onPage: (page: number) => r.pages.push(packed.cutLinks[r.w].pageBase + page),
    onNode: (node: number) => {
      const at = packed.cutLinks[r.w].nodeBase + node
      r.nodeInts[at * DAG_NODE_FLOATS + NODE_OPEN] = r.worlds[r.w].openAt(node)
      r.nodes.push(at)
    },
  }
  const { worlds, pageWorlds, nodeInts } = r
  for (const links of packed.cutLinks) worlds.push(blankOf(r, links))
  // Nothing is resident yet: each node holds its DAG's own open count, and only what then moves
  // is ever handed over.
  for (let n = 0; n < packed.nodeCount; n++) nodeInts[n * DAG_NODE_FLOATS + NODE_OPEN] = 0
  worlds.forEach((_, at) => openNodes(r, at))
  return {
    /** The rule's `resident(c)` and `resident(childGroup(c))` of packed page `page`; a page no
     *  placement holds — room a growth has not filled — is neither. */
    isReady(page: number) {
      const at = pageWorlds[page]
      return !!worlds[at]?.isReady(page - packed.cutLinks[at].pageBase)
    },
    isChildReady(page: number) {
      const at = pageWorlds[page]
      return !!worlds[at]?.isChildReady(page - packed.cutLinks[at].pageBase)
    },
    /** The placements a growth appended (`appendDagRoots`), up to `packed.cutLinks`' end: each
     *  reads its primitive's state with nothing resident, its nodes at their open counts. */
    append() {
      for (let at = worlds.length; at < packed.cutLinks.length; at++) {
        worlds.push(blankOf(r, packed.cutLinks[at]))
        openNodes(r, at)
      }
    },
    /** The placements holding a state of their own: those a page of which is resident. */
    get heldPlacements() {
      return r.heldCount
    },
    /** Bytes of the host tables: each placement's state, sized by its resident pages. Read in
     *  constant time, whatever the number of placements (#483 rule 7). */
    get hostBytes() {
      return r.hostBytes
    },
    /** Reads `resident` at the pages `changes` names — every page when there is none —,
     *  and settles: what is handed over is what moved from the state with nothing resident. */
    apply: (resident: ArrayLike<number>, changes?: ResidencyChanges) => apply(r, resident, changes),
  }
}

type Readiness = {
  packed: PackedDag
  nodeInts: Uint32Array
  pageWorlds: Uint32Array
  /** A placement holds its own state only while one of its pages is resident: otherwise it reads
   *  its primitive's state with nothing resident, one shared by every placement of the primitive
   *  (an instance reads its primitive's pages, it holds none). The heap thus follows what is
   *  resident, never the placement count (#1235, #483 rule 6). */
  blank: Map<CullingLinks, Map<DagCutLinks['structure'], CutReadiness>>
  worlds: CutReadiness[]
  held: Uint8Array
  heldCount: number
  /** Placements `set` touched since the last settle. */
  dirty: Set<number>
  pages: number[]
  nodes: number[]
  /** The placement being settled, which `onPage` and `onNode` read. */
  w: number
  /** Every placement's `hostBytes`, kept as a running total: each settle adds what moved. */
  hostBytes: number
  onPage: (page: number) => void
  onNode: (node: number) => void
}

function blankOf(r: Readiness, { structure, links }: DagCutLinks) {
  let byStructure = r.blank.get(links)
  if (!byStructure) r.blank.set(links, (byStructure = new Map()))
  let shared = byStructure.get(structure)
  if (!shared) byStructure.set(structure, (shared = createCutReadiness(structure, links)))
  return shared
}

function own(r: Readiness, at: number) {
  if (!r.held[at]) {
    r.held[at] = 1
    r.heldCount++
    r.worlds[at] = createCutReadiness(r.packed.cutLinks[at].structure, r.packed.cutLinks[at].links)
  }
  return r.worlds[at]
}

/** Settles every placement `set` touched; returns the sorted, repeat-free packed pages whose
 *  readiness changed and nodes whose `open` changed. */
function settle(r: Readiness) {
  const { worlds, pages, nodes } = r
  pages.length = 0
  nodes.length = 0
  for (const touched of r.dirty) {
    const world = worlds[(r.w = touched)]
    r.hostBytes += world.settle(r.onPage, r.onNode)
    // Its last page left: it reads the shared state again, which holds the same values.
    if (world.holdsNothing) {
      r.hostBytes -= world.hostBytes
      worlds[touched] = blankOf(r, r.packed.cutLinks[touched])
      r.held[touched] = 0
      r.heldCount--
    }
  }
  r.dirty.clear()
  uniqueSortedInPlace(pages)
  uniqueSortedInPlace(nodes)
  return { pages, nodes }
}

function set(r: Readiness, page: number, value: boolean) {
  const at = r.pageWorlds[page]
  if (!value && !r.held[at]) return
  if (own(r, at).set(page - r.packed.cutLinks[at].pageBase, value)) r.dirty.add(at)
}

/** Placement `at`'s nodes at its DAG's own open counts: what nothing resident leaves. */
function openNodes(r: Readiness, at: number) {
  const { nodeBase, nodeCount } = r.packed.cutLinks[at]
  for (let n = 0; n < nodeCount; n++)
    r.nodeInts[(nodeBase + n) * DAG_NODE_FLOATS + NODE_OPEN] = r.worlds[at].openAt(n)
}

function apply(r: Readiness, resident: ArrayLike<number>, changes: ResidencyChanges | undefined) {
  if (changes)
    for (let i = 0; i < changes.count; i++) set(r, changes.pages[i], !!resident[changes.pages[i]])
  else for (let page = 0; page < r.packed.pageCount; page++) set(r, page, !!resident[page])
  return settle(r)
}
