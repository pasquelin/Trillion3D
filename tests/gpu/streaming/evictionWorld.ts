// The generated world the eviction proofs fly through: `copies` primitives of the cut-rule DAG in a
// row along +x — each its own content, its own pages —, the strip camera looking down the row, and
// the frame's view of it at any x. Nothing names a bench scene: a DAG of groups and the groups
// replacing them, placed many times, as a world of them is.
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'
import type { GpuSelection } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { pageAddress } from '../../../packages/sdk-browser/src/webgpu/row/pageSlots.ts'
import { placedRuleDag } from '../kit/placedRuleDag.ts'

/** Bytes of a page: its rank, its complement, and two more words. */
export const PAGE_BYTES = 16

/** A world of `copies` DAGs of `leaves` leaves, `gap` units apart, each a primitive of its own. */
export function evictionWorld(copies: number, leaves = 64, gap = 8) {
  const spacing = leaves + gap
  // Placed along +x; each copy its own culling nodes, so its own records and its own content keys.
  const placed = placedRuleDag(copies, -spacing, leaves, (roots) =>
    roots.map((root) => ({
      ...root,
      culling: { ...root.culling!, nodes: Float64Array.from(root.culling!.nodes) },
    })),
  )
  const { dag, roots, packed, placement } = placed
  const pages = roots.flatMap((root) => root.pages) as unknown as PageRec[]
  /** The camera at `x` down the row, its worlds brought to its render frame and sent to
   *  `selection`: the uniforms it cuts under. */
  const view = (x: number, selection?: GpuSelection) => {
    const uniforms = placed.view(x)
    selection?.updateWorlds(packed.worlds)
    return uniforms
  }
  /** Each packed page's leaf units, by copy: what a cut covers (`coverFault`). */
  const units = pages.map((rec) => (rec as unknown as { units: [number, number] }).units)
  const copyOf = (page: number) => Math.floor(page / dag.pages.length)
  /** The root cover: the pages nothing replaces, the tops of the copies. */
  const cover = pages
    .filter((_, page) => (dag.structure.owners[page % dag.pages.length] ?? -1) < 0)
    .map(pageAddress)
  const rankOfAddress = new Map(pages.map((rec, rank) => [pageAddress(rec), rank]))
  /** A page source whose bytes name each page, landing after a delay `next` draws, between
   *  frames. */
  const source = (next: () => number) => ({
    read: (key: string) =>
      new Promise<Uint8Array>((done) => {
        const rank = rankOfAddress.get(key)!
        const words = Uint32Array.of(rank, ~rank >>> 0, 0x5157, rank ^ 0xa5a5)
        setTimeout(() => done(new Uint8Array(words.buffer)), Math.floor(next() * 40))
      }),
  })
  return {
    ...{ dag, roots, packed, pages, placement, view, units, copyOf, spacing, cover },
    rankOfAddress,
    source,
  }
}
