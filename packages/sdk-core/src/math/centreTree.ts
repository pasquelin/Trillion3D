/**
 * THE SHAPE OF A BOUNDING-VOLUME HIERARCHY over points — the centres of whatever it bounds —,
 * shared by the triangle tree of collisions (`../collision/triangleTree.ts`) and the transparent
 * items' box tree (`sdk-browser/src/webgpu/blend/hierarchy.ts`). Each keeps its own boxes.
 *
 * Top-down: a node's entries are split near the median of their centres along the longest axis of
 * the centres' box — the left side rounded up to whole leaves — until a node holds at most `leaf`.
 * The split keeps the tree balanced whatever the entries: exactly `centreTreeNodes` nodes, a depth
 * of about `log2(n / leaf)`. The median is selected in linear time (a partition, not a sort), so
 * the build is `O(n log n)`. Nodes are in pre-order: the left child follows its parent.
 */

/** Nodes of the tree over `count` entries, `leaf` at most per leaf. */
export const centreTreeNodes = (count: number, leaf: number) =>
  2 * Math.max(1, Math.ceil(count / leaf)) - 1

/**
 * Builds the tree over `order[0, count)`, entry ranks whose centre `r` is `centres[3r..3r+3)`,
 * reordering `order` in leaf order. Per node, `links` gets the first entry of a leaf or the right
 * child of an inner node, `counts` the entries of a leaf (left at 0 for an inner node); `visit` hears each node with its
 * entry span as it is created, before its split. Returns the node count.
 */
export function buildCentreTree(
  centres: Float32Array,
  order: Uint32Array,
  count: number,
  leaf: number,
  links: Int32Array,
  counts: Int32Array,
  visit?: (node: number, start: number, end: number) => void,
) {
  let nodes = 0
  const build = (start: number, end: number): number => {
    const node = nodes++
    visit?.(node, start, end)
    if (end - start <= leaf) {
      links[node] = start
      counts[node] = end - start
      return node
    }
    // The left half takes a whole number of full leaves: every leaf but the last is full.
    const axis = longestAxis(centres, order, start, end),
      middle = start + leaf * Math.ceil((end - start) / (2 * leaf))
    selectMedian(order, centres, axis, start, end, middle)
    build(start, middle)
    links[node] = build(middle, end)
    return node
  }
  build(0, count)
  return nodes
}

function longestAxis(centres: Float32Array, order: Uint32Array, start: number, end: number) {
  let axis = 0,
    widest = -1
  for (let k = 0; k < 3; k++) {
    let low = Infinity,
      high = -Infinity
    for (let i = start; i < end; i++) {
      const value = centres[3 * order[i] + k]
      low = Math.min(low, value)
      high = Math.max(high, value)
    }
    if (high - low > widest) [widest, axis] = [high - low, k]
  }
  return axis
}

/** Rearranges `order[start..end)` so `order[middle]` has the median centre on `axis`, the
 *  smaller before it and the larger after: a linear-time selection by repeated partition. */
function selectMedian(
  order: Uint32Array,
  centres: Float32Array,
  axis: number,
  start: number,
  end: number,
  middle: number,
) {
  const key = (i: number) => centres[3 * order[i] + axis]
  let low = start,
    high = end - 1
  while (low < high) {
    const pivot = key((low + high) >> 1)
    let i = low,
      j = high
    while (i <= j) {
      while (key(i) < pivot) i++
      while (key(j) > pivot) j--
      if (i <= j) {
        ;[order[i], order[j]] = [order[j], order[i]]
        i++
        j--
      }
    }
    if (middle <= j) high = j
    else if (middle >= i) low = i
    else return
  }
}
