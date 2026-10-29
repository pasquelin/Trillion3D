import {
  RAY_TRACING_LEAF_COUNT_SHIFT,
  RAY_TRACING_LEAF_TRIANGLES,
  RAY_TRACING_MIN_EXPONENT,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_STACK,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_WIDTH,
} from '../contracts/rayTracingAbi.ts'

/**
 * THE TREE OF A MESH THE COMPILER DID NOT BUILD, built where the mesh is made: the structure a ray walks (`rayTracingFile.ts`),
 * over the triangles of a mesh a world cuts at run time, in the layout the compiler writes it in (`ray_tracing/` of the compiler),
 * so that the one walk reads both. It follows the compiler's steps and takes its values, but its bytes are not promised equal:
 * where no bin cut exists (centres on one point, or all in one bin) the compiler halves a node with `select_nth_unstable_by`,
 * whose order within the halves is not specified; here the halves are sorted whole by the same key, so they hold the same triangles,
 * and the leaves may take them in another order. And a tree the walk's stack would not hold even split in halves is none, where the
 * compiler stops with `RAY_TRACING_TREE_TOO_DEEP`. The steps:
 *
 * 1. a binary tree over the triangles, each node split at the cheapest of the cuts between `BINS` bins of the triangles' centres
 *    along each axis — each side's box surface times its triangle count —, a node of no more than `RAY_TRACING_LEAF_TRIANGLES` a leaf;
 * 2. the tree collapsed into nodes of eight children, a node opening the child of largest surface until it has eight children or
 *    none of them has children of its own (Ylitie, Karras, Laine, "Efficient Incoherent Ray Traversal on GPUs Through Compressed
 *    Wide BVHs", 2017), the nodes and the leaves' triangles laid breadth first;
 * 3. the nodes as words: each child's box quantised to a byte a side in its node's frame, rounded outwards.
 *
 * Boxes and costs are `f32`, as the compiler's.
 */

/** The bins a node's centres are dropped into along an axis. */
const BINS = 16

/** The tree of a mesh: its nodes and its triangles as the words the GPU reads (`RayTracing.nodes`, `RayTracing.triangles`), and the box of its triangles. */
export interface RayTracingTree {
  readonly nodes: Uint32Array
  readonly triangles: Uint32Array
  readonly low: readonly [number, number, number]
  readonly high: readonly [number, number, number]
}

/** A box as six floats, its low corner then its high corner. */
type Box = Float32Array

const f = Math.fround
function newBox() {
  return new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
}
const EMPTY = newBox()
/** `box` grown to hold the six floats `other` from word `at`. */
function extend(box: Box, other: Float32Array, at: number) {
  for (let a = 0; a < 3; a++) {
    if (other[at + a] < box[a]) box[a] = other[at + a]
    if (other[at + 3 + a] > box[3 + a]) box[3 + a] = other[at + 3 + a]
  }
}
/** The box surface of the box at word `at` of `boxes` (`half_area`): its sides at least zero, in `f32`. */
function halfArea(boxes: Float32Array, at = 0) {
  const x = f(Math.max(f(boxes[at + 3] - boxes[at]), 0)),
    y = f(Math.max(f(boxes[at + 4] - boxes[at + 1]), 0)),
    z = f(Math.max(f(boxes[at + 5] - boxes[at + 2]), 0))
  return f(f(f(x * y) + f(y * z)) + f(z * x))
}

/** The triangles' boxes (six floats each) and centres (three each). */
interface Items {
  readonly count: number
  readonly bounds: Float32Array
  readonly centres: Float32Array
}

/** The boxes and centres of the triangles `indices` name in `positions`; a range error for an index out of the vertices or a corner that is not a number. */
function itemsOf(positions: ArrayLike<number>, indices: ArrayLike<number>): Items {
  if (positions.length % 3 !== 0)
    throw new RangeError('ray tracing tree: the positions are not triples')
  if (indices.length % 3 !== 0)
    throw new RangeError('ray tracing tree: the indices are not triples')
  const vertices = positions.length / 3
  const count = indices.length / 3
  const bounds = new Float32Array(count * 6),
    centres = new Float32Array(count * 3)
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const index = indices[3 * t + k]
      if (!Number.isInteger(index) || index < 0 || index >= vertices)
        throw new RangeError(
          `ray tracing tree: triangle ${t} names the vertex ${index} of ${vertices}`,
        )
    }
    for (let a = 0; a < 3; a++) {
      const c0 = f(positions[3 * indices[3 * t] + a]),
        c1 = f(positions[3 * indices[3 * t + 1] + a]),
        c2 = f(positions[3 * indices[3 * t + 2] + a])
      if (!Number.isFinite(c0 + c1 + c2))
        throw new RangeError(
          `ray tracing tree: triangle ${t} has a corner that is not a finite number`,
        )
      const low = Math.min(c0, c1, c2),
        high = Math.max(c0, c1, c2)
      bounds[6 * t + a] = low
      bounds[6 * t + 3 + a] = high
      centres[3 * t + a] = f(f(low + high) * 0.5)
    }
  }
  return { count, bounds, centres }
}

/** The box of the items `order[from..to]`. */
function boundsOf(items: Items, order: Uint32Array, from: number, to: number) {
  const box = newBox()
  for (let k = from; k < to; k++) extend(box, items.bounds, 6 * order[k])
  return box
}

/** The bins of one cut, reused: how many items and the box of them, for each bin, for what lies past each bin, and for what lies before the cut. */
const binCount = new Int32Array(BINS),
  binBox = new Float32Array(BINS * 6),
  pastCount = new Int32Array(BINS),
  pastBox = new Float32Array(BINS * 6),
  before = new Float32Array(6)

interface Cut {
  axis: number
  origin: number
  scale: number
  bin: number
  cost: number
  /** The boxes of the two sides, twelve floats. */
  sides: Float32Array
}

/** The bin of the centre of item `id` along `axis`. */
function binOf(items: Items, id: number, axis: number, origin: number, scale: number) {
  const at = f(f(items.centres[3 * id + axis] - origin) * scale)
  return Math.min(Math.trunc(at > 0 ? at : 0), BINS - 1)
}

/** The box at word `to` of `out` is the box at `a` of `from` joined with the box at `b` of `other`, the empty one adding nothing. */
function merge(
  out: Float32Array,
  to: number,
  from: Float32Array,
  a: number,
  other: Float32Array,
  b: number,
) {
  for (let k = 0; k < 6; k++) out[to + k] = from[a + k]
  for (let k = 0; k < 3; k++) {
    if (other[b + k] < out[to + k]) out[to + k] = other[b + k]
    if (other[b + 3 + k] > out[to + 3 + k]) out[to + 3 + k] = other[b + 3 + k]
  }
}

/** The cheapest cut of the items `order[from..to]` along `axis` between its bins, none when the centres lie in one bin. */
function axisCut(
  items: Items,
  order: Uint32Array,
  from: number,
  to: number,
  axis: number,
  origin: number,
  scale: number,
) {
  binCount.fill(0)
  for (let b = 0; b < BINS; b++) binBox.set(EMPTY, 6 * b)
  for (let k = from; k < to; k++) {
    const id = order[k],
      bin = binOf(items, id, axis, origin, scale)
    binCount[bin]++
    for (let a = 0; a < 3; a++) {
      binBox[6 * bin + a] = Math.min(binBox[6 * bin + a], items.bounds[6 * id + a])
      binBox[6 * bin + 3 + a] = Math.max(binBox[6 * bin + 3 + a], items.bounds[6 * id + 3 + a])
    }
  }
  // What lies past each bin: the box of the bins after it and how many items they hold.
  pastCount[BINS - 1] = 0
  pastBox.set(EMPTY, 6 * (BINS - 1))
  for (let bin = BINS - 2; bin >= 0; bin--) {
    pastCount[bin] = pastCount[bin + 1] + binCount[bin + 1]
    merge(pastBox, 6 * bin, pastBox, 6 * (bin + 1), binBox, 6 * (bin + 1))
  }
  let count = 0
  before.set(EMPTY)
  let best: Cut | undefined
  for (let bin = 0; bin < BINS - 1; bin++) {
    count += binCount[bin]
    extend(before, binBox, 6 * bin)
    if (count === 0 || pastCount[bin] === 0) continue
    const cost = f(f(halfArea(before) * count) + f(halfArea(pastBox, 6 * bin) * pastCount[bin]))
    if (best && !(cost < best.cost)) continue
    const sides = new Float32Array(12)
    sides.set(before)
    sides.set(pastBox.subarray(6 * bin, 6 * bin + 6), 6)
    best = { axis, origin, scale, bin, cost, sides }
  }
  return best
}

/** The box of the centres of the items `order[from..to]`, low corner then high. */
function centresOf(items: Items, order: Uint32Array, from: number, to: number) {
  const box = newBox()
  for (let k = from; k < to; k++)
    for (let a = 0; a < 3; a++) {
      const c = items.centres[3 * order[k] + a]
      if (c < box[a]) box[a] = c
      if (c > box[3 + a]) box[3 + a] = c
    }
  return box
}

function cheapestCut(items: Items, order: Uint32Array, from: number, to: number) {
  const centres = centresOf(items, order, from, to)
  let best: Cut | undefined
  for (let axis = 0; axis < 3; axis++) {
    if (!(centres[3 + axis] > centres[axis])) continue
    const scale = f(BINS / f(centres[3 + axis] - centres[axis]))
    const cut = axisCut(items, order, from, to, axis, centres[axis], scale)
    if (cut && (!best || cut.cost < best.cost)) best = cut
  }
  return best
}

/** The ids reordered so that the items on the first side of `cut` come first, from `from` to `to`; the size of that side. */
function partition(items: Items, order: Uint32Array, from: number, to: number, cut: Cut) {
  let first = from
  for (let at = from; at < to; at++)
    if (binOf(items, order[at], cut.axis, cut.origin, cut.scale) <= cut.bin) {
      const taken = order[at]
      order[at] = order[first]
      order[first++] = taken
    }
  return first - from
}

/** The ids halved around the median centre along the axis the centres spread most on; the size of the first half and the boxes of the halves, twelve floats. */
function halved(items: Items, order: Uint32Array, from: number, to: number) {
  const centres = centresOf(items, order, from, to)
  let axis = 0
  for (let a = 1; a < 3; a++)
    if (f(centres[3 + a] - centres[a]) >= f(centres[3 + axis] - centres[axis])) axis = a
  const ids = order
    .slice(from, to)
    .sort((a, b) => items.centres[3 * a + axis] - items.centres[3 * b + axis] || a - b)
  order.set(ids, from)
  const middle = Math.floor(ids.length / 2)
  const sides = new Float32Array(12)
  sides.set(boundsOf(items, order, from, from + middle))
  sides.set(boundsOf(items, order, from + middle, to), 6)
  return { size: middle, sides }
}

interface BinaryNode {
  box: Box
  /** The range of the order a leaf holds, or the two children of an inner node. */
  leaf?: { first: number; count: number }
  children?: [number, number]
}

/** The binary tree over `items`, every node split at its cheapest cut, or in halves when `even`. */
function build(items: Items, even: boolean) {
  const order = Uint32Array.from({ length: items.count }, (_, k) => k)
  const nodes: BinaryNode[] = [{ box: boundsOf(items, order, 0, items.count) }]
  const pending = [{ at: 0, from: 0, to: items.count }]
  for (let job = pending.pop(); job; job = pending.pop()) {
    const { at, from, to } = job
    if (to - from <= RAY_TRACING_LEAF_TRIANGLES) {
      nodes[at].leaf = { first: from, count: to - from }
      continue
    }
    const cut = even ? undefined : cheapestCut(items, order, from, to)
    const split = cut
      ? { size: partition(items, order, from, to, cut), sides: cut.sides }
      : halved(items, order, from, to)
    const children: [number, number] = [nodes.length, nodes.length + 1]
    nodes.push({ box: split.sides.slice(0, 6) }, { box: split.sides.slice(6, 12) })
    nodes[at].children = children
    pending.push(
      { at: children[0], from, to: from + split.size },
      { at: children[1], from: from + split.size, to },
    )
  }
  return { nodes, order }
}

type Slot =
  | { kind: 'empty' }
  | { kind: 'inner'; box: Box }
  | { kind: 'leaf'; box: Box; count: number; offset: number }
interface WideNode {
  box: Box
  childBase: number
  triangleBase: number
  slots: Slot[]
}

/** The children of the binary node `at` a wide node holds: its two, then the child of largest surface replaced by its two while there are fewer than eight. */
function opened(nodes: BinaryNode[], at: number) {
  const first = nodes[at].children
  if (!first) return [at]
  const children = [...first]
  while (children.length < RAY_TRACING_WIDTH) {
    let widest = -1
    for (let k = 0; k < children.length; k++) {
      if (!nodes[children[k]].children) continue
      // Among equal surfaces, the earlier child.
      if (widest < 0 || halfArea(nodes[children[k]].box) > halfArea(nodes[children[widest]].box))
        widest = k
    }
    if (widest < 0) break
    children.splice(widest, 1, ...nodes[children[widest]].children!)
  }
  return children
}

/** The wide tree of `binary`: its nodes breadth first and the order of the triangles its leaves take. */
function collapse({ nodes, order }: ReturnType<typeof build>) {
  const wide: WideNode[] = [],
    triangles: number[] = [],
    queue = [0]
  while (wide.length < queue.length) {
    const at = queue[wide.length]
    const childBase = queue.length,
      triangleBase = triangles.length
    const slots: Slot[] = Array.from({ length: RAY_TRACING_WIDTH }, () => ({ kind: 'empty' }))
    opened(nodes, at).forEach((child, slot) => {
      const { box, leaf } = nodes[child]
      if (!leaf) {
        queue.push(child)
        slots[slot] = { kind: 'inner', box }
        return
      }
      slots[slot] = {
        kind: 'leaf',
        box,
        count: leaf.count,
        offset: triangles.length - triangleBase,
      }
      for (let k = 0; k < leaf.count; k++) triangles.push(order[leaf.first + k])
    })
    wide.push({ box: nodes[at].box, childBase, triangleBase, slots })
  }
  return { wide, triangles }
}

/** The most nodes the walk's stack holds going down `wide`: at a node every internal child but the nearest, and the most of its children's. */
function stackNeed(wide: WideNode[]) {
  const need = new Array<number>(wide.length).fill(0)
  for (let rank = wide.length - 1; rank >= 0; rank--) {
    const inner = wide[rank].slots.filter((slot) => slot.kind === 'inner').length
    if (inner === 0) continue
    let deepest = 0
    for (let c = wide[rank].childBase; c < wide[rank].childBase + inner; c++)
      deepest = Math.max(deepest, need[c])
    need[rank] = inner - 1 + deepest
  }
  return need[0] ?? 0
}

/** The exponent of the least power of two whose 255 steps span `extent`, no less than `RAY_TRACING_MIN_EXPONENT`. */
function exponent(extent: number) {
  if (extent <= 0) return RAY_TRACING_MIN_EXPONENT
  let e = Math.ceil(Math.log2(extent / 255))
  while (2 ** e * 255 < extent) e++
  return Math.min(Math.max(e, RAY_TRACING_MIN_EXPONENT), 127)
}

/** The words of the nodes of `wide`, as the compiler lays a node out (`ray_tracing/nodes.rs`). */
function nodeWords(wide: WideNode[]) {
  const bytes = new ArrayBuffer(wide.length * RAY_TRACING_NODE_BYTES)
  const view = new DataView(bytes)
  wide.forEach((node, rank) => {
    const at = rank * RAY_TRACING_NODE_BYTES
    const { box } = node
    const exponents = [0, 1, 2].map((a) => exponent(box[3 + a] - box[a]))
    for (let a = 0; a < 3; a++) {
      view.setFloat32(at + 4 * a, box[a], true)
      view.setInt8(at + 12 + a, exponents[a])
    }
    let mask = 0
    node.slots.forEach((slot, s) => {
      if (slot.kind === 'inner') mask |= 1 << s
    })
    view.setUint8(at + 15, mask)
    view.setUint32(at + 16, node.childBase, true)
    view.setUint32(at + 20, node.triangleBase, true)
    node.slots.forEach((slot, s) =>
      view.setUint8(
        at + 24 + s,
        slot.kind === 'leaf' ? (slot.count << RAY_TRACING_LEAF_COUNT_SHIFT) | slot.offset : 0,
      ),
    )
    // The low corners rounded down, then the high corners rounded up, an axis at a time, a byte a slot.
    for (const [end, round] of [
      [0, Math.floor],
      [3, Math.ceil],
    ] as const)
      for (let a = 0; a < 3; a++)
        node.slots.forEach((slot, s) => {
          if (slot.kind === 'empty') return
          const steps = Math.min(
            Math.max(round((slot.box[end + a] - box[a]) / 2 ** exponents[a]), 0),
            255,
          )
          view.setUint8(at + 32 + (end === 0 ? 0 : 24) + 8 * a + s, steps)
        })
  })
  return new Uint32Array(bytes)
}

/** The words of the triangles `ranks` of `indices` over `positions` (`RAY_TRACING_TRIANGLE_BYTES` each): its corners, its cluster (none: 0), its rank among the triangles and its tag (0). */
function triangleWords(positions: ArrayLike<number>, indices: ArrayLike<number>, ranks: number[]) {
  const bytes = new ArrayBuffer(ranks.length * RAY_TRACING_TRIANGLE_BYTES)
  const view = new DataView(bytes)
  ranks.forEach((rank, k) => {
    const at = k * RAY_TRACING_TRIANGLE_BYTES
    for (let c = 0; c < 3; c++)
      for (let a = 0; a < 3; a++)
        view.setFloat32(at + 12 * c + 4 * a, positions[3 * indices[3 * rank + c] + a], true)
    view.setUint32(at + 36, 0, true)
    view.setUint32(at + 40, rank, true)
    view.setUint32(at + 44, 0, true)
  })
  return new Uint32Array(bytes)
}

/** One node of the binary tree: its box (six floats) and either the range of `order` its leaf holds or its two children. */
export interface BinaryTreeNode {
  readonly box: Float32Array
  readonly leaf?: { readonly first: number; readonly count: number }
  readonly children?: readonly [number, number]
}

/**
 * The binary tree over the triangles `indices` name in `positions`, split at the cheapest cuts (the first step of `rayTracingTreeOf`),
 * for the queries that walk triangles by their boxes: its nodes, the root first, and the triangles in the order its leaves take them.
 * A `RangeError` for an index out of the vertices or a corner that is not a number; no node for a mesh with no triangle.
 */
export function binaryTreeOf(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): { nodes: readonly BinaryTreeNode[]; order: Uint32Array } | undefined {
  const items = itemsOf(positions, indices)
  return items.count === 0 ? undefined : build(items, false)
}

/**
 * The tree of the triangles `indices` name in `positions` (three floats a vertex, metres), none for a mesh with no triangle or
 * one a walk's stack would not hold even split in halves (the compiler stops with `RAY_TRACING_TREE_TOO_DEEP` there: a mesh cut
 * at run time goes on without its tree instead); `stack` is the nodes the walk holds, `RAY_TRACING_STACK`. A `RangeError` for an index out of the vertices or a corner that is not a number.
 */
export function rayTracingTreeOf(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  stack = RAY_TRACING_STACK,
): RayTracingTree | undefined {
  const items = itemsOf(positions, indices)
  if (items.count === 0) return undefined
  let binary = build(items, false)
  let { wide, triangles } = collapse(binary)
  if (stackNeed(wide) > stack) {
    binary = build(items, true)
    ;({ wide, triangles } = collapse(binary))
    if (stackNeed(wide) > stack) return undefined
  }
  const box = binary.nodes[0].box
  return {
    nodes: nodeWords(wide),
    triangles: triangleWords(positions, indices, triangles),
    low: [box[0], box[1], box[2]],
    high: [box[3], box[4], box[5]],
  }
}

/** The indices of a soup of `positions` (nine floats a triangle): each corner named once, in turn. */
export const soupIndices = (positions: ArrayLike<number>) =>
  Uint32Array.from({ length: positions.length / 3 }, (_, k) => k)

/** The triangles of `tree` as a soup, in the order its leaves hold them: nine floats a triangle (metres) and the indices naming each corner in turn, for the
 *  queries that take a mesh as `positions` and `indices` (`binaryTreeOf`). */
export function treeTriangles(tree: RayTracingTree) {
  const words = RAY_TRACING_TRIANGLE_BYTES / 4
  const corners = new Float32Array(
    tree.triangles.buffer,
    tree.triangles.byteOffset,
    tree.triangles.length,
  )
  const count = tree.triangles.length / words
  const positions = new Float32Array(count * 9)
  for (let t = 0; t < count; t++) positions.set(corners.subarray(t * words, t * words + 9), t * 9)
  return { positions, indices: soupIndices(positions) }
}
