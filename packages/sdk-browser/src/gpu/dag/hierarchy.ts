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
 * level's price. The widest level is about `clusterCount / CULLING_BRANCHING`, so the margin holds
 * up to millions of clusters per primitive.
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
        children = nodes[base + 12]
      for (let c = 0; c < children; c++) next.push(nodes[base + 11] + c)
    }
    if (next.length > count) throw new Error('Inconsistent culling hierarchy')
    frontier = next
  }
  return sizes
}
