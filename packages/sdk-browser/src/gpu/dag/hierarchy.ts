import { boxUnion } from '../../../../math/src/geometry/box.ts'
import { CULL_STRIDE } from './types.ts'
import type { ClusterCut } from '../../page/selection/math.ts'
import { BOUND_STRIDE, cullingBounds, HAS_ROOT, PARENT_SPHERE } from '../../page/cut/bounds.ts'
/**
 * The cut hierarchy as level-by-level descent reads it: its depth, and the one a
 * primitive without a hierarchy receives so descent is the only production path.
 *
 * Node layout, the manifest's: `[0..2]` min box, `[3..5]` max box, `[6..9]` sphere,
 * `[10]` replacement error ceiling, `[11]` first child, `[12]` child count, `[13]`
 * first page, `[14]` page count. Nodes are numbered by levels, root at rank zero:
 * descent therefore only has to start at that rank.
 *
 * The synthesised hierarchy carries what a manifest would: its box is the union of its
 * pages' — a page without a box makes the node box infinite, so the trunk rejects a node
 * only when every page carries a box it also rejects, one by one — and its replacement
 * sphere and error ceiling come from the pages (`fillReplacement`), so descent prunes a
 * too-fine subtree of a primitive without a manifest as it does one with.
 */
const LEAF_PAGES = 32,
  BRANCH = 8,
  STRIDE = CULL_STRIDE,
  INF = Infinity

/** A node as it is built: its box, `[0..2]` min then `[3..5]` max as in the node layout, and its pages. */
type Built = { box: Float64Array; first: number; pages: number; children: Built[] }

const EMPTY_BOX = () => Float64Array.of(INF, INF, INF, -INF, -INF, -INF)

function box(
  pages: ReadonlyArray<{ min?: number[]; max?: number[] }>,
  from: number,
  count: number,
) {
  const out = EMPTY_BOX()
  for (let i = from; i < from + count; i++) {
    const rec = pages[i]
    if (!rec.min || !rec.max) return Float64Array.of(-INF, -INF, -INF, INF, INF, INF)
    boxUnion(out, 0, rec.min[0], rec.min[1], rec.min[2], rec.max[0], rec.max[1], rec.max[2])
  }
  return out
}

function merge(children: Built[]): Built {
  const out = EMPTY_BOX()
  for (const { box: b } of children) boxUnion(out, 0, b[0], b[1], b[2], b[3], b[4], b[5])
  return { box: out, first: 0, pages: 0, children }
}

/** Numbering by levels, root at rank zero: a node's `firstChild` is therefore contiguous. */
function emit(root: Built, count: number) {
  const nodes = new Float64Array(count * STRIDE)
  const queue: Built[] = [root]
  let next = 1
  for (let at = 0; at < queue.length; at++) {
    const node = queue[at],
      base = at * STRIDE
    nodes.set(node.box, base)
    nodes[base + 10] = -1
    nodes[base + 11] = node.children.length ? next : 0
    nodes[base + 12] = node.children.length
    nodes[base + 13] = node.first
    nodes[base + 14] = node.pages
    for (const child of node.children) queue.push(child)
    next += node.children.length
  }
  return { nodes, stride: STRIDE }
}

type FlatPage = ClusterCut & { min?: number[]; max?: number[] }

/**
 * Replacement sphere and error ceiling of each node, read from the pages. The sphere is the
 * one `cullingBounds` already derives (`PARENT_SPHERE`): it encloses every replacement band
 * of the subtree, so the ceiling projected through it never falls under the projection of a
 * band it covers. The ceiling is the largest replacement error of the subtree.
 *
 * A subtree the ceiling cannot certify keeps -1, never pruned on it: one holding a cluster
 * nothing replaces (`HAS_ROOT`), a negative replacement error — the band then projects to
 * infinity — or a band without a sphere, which `cullingBounds` cannot enclose.
 */
function fillReplacement(nodes: Float64Array, pages: readonly FlatPage[], bounds: Float64Array) {
  for (let n = nodes.length / STRIDE - 1; n >= 0; n--) {
    const base = n * STRIDE,
      at = n * BOUND_STRIDE
    let ceil = bounds[at + HAS_ROOT] ? -1 : 0
    for (let c = 0; c < nodes[base + 12] && ceil >= 0; c++) {
      const child = nodes[(nodes[base + 11] + c) * STRIDE + 10]
      ceil = child < 0 ? -1 : Math.max(ceil, child)
    }
    for (let p = 0; p < nodes[base + 14] && ceil >= 0; p++) {
      const rec = pages[nodes[base + 13] + p],
        band = rec.parentSphere ?? rec.sphere,
        error = rec.parentError as number
      ceil = error >= 0 && band && band.length >= 4 && band[3] >= 0 ? Math.max(ceil, error) : -1
    }
    nodes[base + 10] = ceil
    if (ceil >= 0) for (let a = 0; a < 4; a++) nodes[base + 6 + a] = bounds[at + PARENT_SPHERE + a]
  }
}

/** Hierarchy a primitive without a hierarchy receives: thirty-two-page leaves, eight-child
 *  nodes, up to a single root. A primitive with no page keeps an empty leaf root. `bounds`
 *  are the ones `cullingBounds` derives, handed to packing so it does not derive them again. */
export function flatHierarchy(pages: readonly FlatPage[]) {
  let level: Built[] = []
  for (let first = 0; first < pages.length; first += LEAF_PAGES) {
    const count = Math.min(LEAF_PAGES, pages.length - first)
    level.push({ box: box(pages, first, count), first, pages: count, children: [] })
  }
  if (!level.length) level.push({ box: new Float64Array(6), first: 0, pages: 0, children: [] })
  let total = level.length
  while (level.length > 1) {
    const up: Built[] = []
    for (let at = 0; at < level.length; at += BRANCH) up.push(merge(level.slice(at, at + BRANCH)))
    total += up.length
    level = up
  }
  const culling = emit(level[0], total)
  const bounds = cullingBounds(culling, pages)
  fillReplacement(culling.nodes, pages, bounds)
  return { ...culling, bounds }
}

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
