import { CULL_CHILD_COUNT, CULL_FIRST_CHILD } from './types.ts'
import type { CullingLinks } from '../cut/links.ts'
import type { ClusterStructureIndex } from '../selection/types.ts'

/**
 * Node count of each hierarchy level, root at level zero. Its length is the depth,
 * i.e. the number of passes descent needs to exhaust it.
 *
 * Level `L` UPPER-BOUNDS pass `L`'s queue: that queue only holds children of nodes
 * kept at level `L-1`, hence only nodes of level `L`, and descent writes them there
 * compacted from zero. That bound, known from packing once and for all, lets the first
 * levels launch FLAT; past level 1 a stage sums every placement's nodes of the level, the
 * world's, and the pass launches on what the level before it deposited instead, its
 * argument armed by a dispatch of the head pass (`shader/levelWgsl.ts`) — never a copy
 * outside it, which is what the measurement below prices.
 *
 * THE MEASUREMENT THAT JUSTIFIES IT, taken when the arming was introduced against the cut that
 * opened a pass a level: on a Metal 3 device, one more level costs about 26 µs when it opens its
 * own pass behind two off-pass copies, and about 1.5 µs when it is a flat dispatch in the head
 * pass. The cost of the children that leave at once is bounded: a level announced at 100,000 nodes
 * costs as much as a level of 657, and it takes announcing 1,000,000 to recover the previous
 * level's price. The widest level holds about one leaf per group part, a few clusters each
 * (`page-codec-wasm/src/culling.rs`), so the margin holds up to millions of clusters per primitive.
 */
export function hierarchyLevelSizes(nodes: Float64Array, stride: number) {
  const count = nodes.length / stride
  const sizes: number[] = []
  if (count < 1) return sizes
  let frontier = [0]
  while (frontier.length) {
    sizes.push(frontier.length)
    const next: number[] = []
    for (const node of frontier) {
      const base = node * stride,
        children = nodes[base + CULL_CHILD_COUNT]
      for (let c = 0; c < children; c++) next.push(nodes[base + CULL_FIRST_CHILD] + c)
    }
    if (next.length > count) throw new Error('Inconsistent culling hierarchy')
    frontier = next
  }
  return sizes
}

/**
 * The deepest level of the hierarchy a descent must reach for each cluster of a primitive once the
 * cluster is resident: its leaf's own level, and — so the descent reaches the finer clusters that
 * replace it, which only a resident page lets it ask for — the deepest leaf level among the
 * clusters of every group it is an output of. A level a resident cluster does not need reached is
 * never dispatched (`../encode.ts`, `PackedDag.residentLevels`). A cluster in no leaf stands at
 * level 0.
 */
export function pageDepths(
  nodes: Float64Array,
  stride: number,
  links: CullingLinks,
  structure: ClusterStructureIndex | undefined,
) {
  const count = nodes.length / stride,
    level = new Uint8Array(count)
  const frontier = count ? [0] : []
  for (let at = 0; at < frontier.length; at++) {
    const base = frontier[at] * stride,
      children = nodes[base + CULL_CHILD_COUNT]
    for (let c = 0; c < children; c++) {
      const child = nodes[base + CULL_FIRST_CHILD] + c
      level[child] = level[frontier[at]] + 1
      frontier.push(child)
    }
  }
  const own = new Uint8Array(links.leafOfPage.length),
    depth = new Uint8Array(own.length)
  for (let page = 0; page < own.length; page++) {
    const leaf = links.leafOfPage[page]
    depth[page] = own[page] = leaf < 0 ? 0 : level[leaf]
  }
  if (!structure) return depth
  const s = structure
  for (let g = 0; g < s.groupCount; g++) {
    let deepest = 0
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++)
      deepest = Math.max(deepest, own[s.children[i]])
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++)
      depth[s.outputs[i]] = Math.max(depth[s.outputs[i]], deepest)
  }
  return depth
}
