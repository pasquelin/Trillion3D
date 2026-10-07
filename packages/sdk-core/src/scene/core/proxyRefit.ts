import type { SceneProxyColumns } from '../../contracts/proxy.ts'
import { proxyBoxesExtent, proxyTriangleBoxes } from './proxyBoxes.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { FLOAT32_STEP } from '../../../../math/src/constants.ts'

const rounded = new Float32Array(1),
  NO_LEAF = 0xffffffff
const bits = new Uint32Array(rounded.buffer)
/** Round a bound outwards, including negative zero and subnormals. */
function outward(value: number, upper: boolean) {
  rounded[0] = value
  if (upper ? rounded[0] < value : rounded[0] > value) {
    if (rounded[0] === 0) bits[0] = upper ? 1 : 0x80000001
    else bits[0] += rounded[0] > 0 === upper ? 1 : -1
  }
  return rounded[0]
}

/**
 * The node whose leaf child holds each triangle, so a refit marks the leaves of the moved
 * triangles instead of scanning every leaf of the tree. The topology never changes (a refit
 * rewrites only quantized bytes; `proxyLeaves.ts` only flags present slots). A triangle in two
 * leaves, which no build makes, keeps the scan: `shared`.
 */
function indexLeaves(nodeChildren: SceneProxyColumns['nodeChildren'], triangleCount: number) {
  const leafNode = new Uint32Array(triangleCount).fill(NO_LEAF)
  let shared = false
  for (let at = 0; at < nodeChildren.length; at += 3) {
    const flags = nodeChildren[at + 1]
    if (flags >>> 24 === 0) continue
    const node = Math.floor(at / 12),
      first = nodeChildren[at + 2],
      end = Math.min(first + ((flags >>> 16) & 255), leafNode.length)
    for (let t = first; t < end; t++) {
      shared ||= leafNode[t] !== NO_LEAF && leafNode[t] !== node
      leafNode[t] = node
    }
  }
  return { leafNode, shared }
}

/** Writes each present child of `node` as bytes of the node's own box, one unit wider each way. */
function quantizeChildren(
  nodeChildren: SceneProxyColumns['nodeChildren'],
  nodeBounds: SceneProxyColumns['nodeBounds'],
  boxes: Float64Array,
  node: number,
  grow: (node: number) => void,
) {
  const base = node * 6
  for (let slot = 0; slot < 4; slot++) {
    const at = node * 12 + slot * 3
    if (nodeChildren[at + 1] >>> 24 === 0) continue
    let low = 0,
      high = nodeChildren[at + 1] & 0xffff0000
    for (let a = 0; a < 6; a++) {
      const axis = a % 3,
        min = nodeBounds[base + axis]
      const span = nodeBounds[base + axis + 3] - min
      // One additional quantization unit covers shader subtraction and reconstruction rounding.
      const unit = span > 0 ? ((boxes[slot * 6 + a] - min) / span) * 255 : a < 3 ? 0 : 255
      const q = clamp(a < 3 ? Math.floor(unit) - 1 : Math.ceil(unit) + 1, 0, 255)
      if (a < 4) low |= q << (a * 8)
      else high |= q << ((a - 4) * 8)
    }
    nodeChildren[at] = low
    nodeChildren[at + 1] = high
    if (((high >>> 16) & 255) === 0) grow(nodeChildren[at + 2])
  }
}

/** Widens triangle `t`'s box and error over its three vertices moved by one owner's matrix. */
function growTriangle(
  bounds: Float64Array | Float32Array,
  errors: Float64Array,
  triangles: SceneProxyColumns['triangles'],
  transforms: Float32Array,
  matrix: number,
  t: number,
) {
  const at = t * 6
  for (let v = 0; v < 3; v++)
    for (let a = 0; a < 3; a++) {
      const p = t * 9 + v * 3
      const x = transforms[matrix + a] * triangles[p]
      const y = transforms[matrix + a + 4] * triangles[p + 1]
      const z = transforms[matrix + a + 8] * triangles[p + 2]
      const w = transforms[matrix + a + 12]
      const value = x + y + z + w
      // Four f32 products/additions: gamma(7) bounds either fused or separate evaluation.
      const error =
        (Math.abs(x) + Math.abs(y) + Math.abs(z) + Math.abs(w)) *
        ((3.5 * FLOAT32_STEP) / (1 - 3.5 * FLOAT32_STEP))
      bounds[at + a] = Math.min(bounds[at + a], value)
      bounds[at + a + 3] = Math.max(bounds[at + a + 3], value)
      errors[t * 3 + a] = Math.max(errors[t * 3 + a], error)
    }
}

/** Sets `node`'s box to the union of its children, and each child's own box into `boxes`. */
function fitChildren(
  nodeChildren: SceneProxyColumns['nodeChildren'],
  nodeBounds: SceneProxyColumns['nodeBounds'],
  bounds: Float64Array | Float32Array,
  errors: Float64Array,
  boxes: Float64Array,
  node: number,
) {
  const base = node * 6
  for (let slot = 0; slot < 4; slot++) {
    const at = node * 12 + slot * 3,
      flags = nodeChildren[at + 1]
    if (flags >>> 24 === 0) continue
    const count = (flags >>> 16) & 255,
      first = nodeChildren[at + 2]
    for (let a = 0; a < 6; a++) {
      let bound = a < 3 ? Infinity : -Infinity
      if (count === 0) bound = nodeBounds[first * 6 + a]
      else
        for (let t = first; t < first + count; t++)
          bound =
            a < 3
              ? Math.min(bound, bounds[t * 6 + a] - errors[t * 3 + a])
              : Math.max(bound, bounds[t * 6 + a] + errors[t * 3 + a - 3])
      boxes[slot * 6 + a] = bound
      nodeBounds[base + a] = outward(
        a < 3 ? Math.min(nodeBounds[base + a], bound) : Math.max(nodeBounds[base + a], bound),
        a >= 3,
      )
    }
  }
}

/** The triangles of each group in order: `starts` offsets into `slots`, one slot per triangle. */
function groupSlots(groupCount: number, triangleGroups: SceneProxyColumns['triangleGroups']) {
  const starts = new Uint32Array(groupCount)
  for (const group of triangleGroups) starts[group + 1]++
  for (let group = 1; group < starts.length; group++) starts[group] += starts[group - 1]
  const slots = new Uint32Array(triangleGroups.length),
    cursors = starts.slice()
  for (let t = 0; t < triangleGroups.length; t++) {
    slots[cursors[triangleGroups[t]]++] = t
  }
  return { starts, slots }
}

/** A leaf child holds a moved triangle, or an inner child was refitted. */
function childMoved(
  nodeChildren: SceneProxyColumns['nodeChildren'],
  nodeChanged: Uint8Array,
  changed: Uint8Array,
  shared: boolean,
  node: number,
) {
  let dirty = false
  for (let slot = 0; !dirty && slot < 4; slot++) {
    const at = node * 12 + slot * 3,
      flags = nodeChildren[at + 1]
    if (flags >>> 24 === 0) continue
    const count = (flags >>> 16) & 255,
      first = nodeChildren[at + 2]
    if (count === 0) dirty = nodeChanged[first] === 1
    else if (shared) for (let t = first; t < first + count; t++) dirty ||= !!changed[t]
  }
  return dirty
}

/** Rebuilds triangle `t`'s box and error over every owner of its group. */
function moveTriangle(
  { triangles, groupOffsets, owners }: SceneProxyColumns,
  bounds: Float64Array | Float32Array,
  errors: Float64Array,
  transforms: Float32Array,
  group: number,
  t: number,
) {
  const at = t * 6
  for (let a = 0; a < 3; a++) {
    errors[t * 3 + a] = 0
    bounds[at + a] = Infinity
    bounds[at + a + 3] = -Infinity
  }
  for (let owner = groupOffsets[group]; owner < groupOffsets[group + 1]; owner++)
    growTriangle(bounds, errors, triangles, transforms, owners[owner * 2] * 16, t)
}

/** The summed size of typed arrays, in bytes. */
const byteLengths = (...arrays: { byteLength: number }[]) =>
  arrays.reduce((sum, array) => sum + array.byteLength, 0)

/**
 * Nodes whose effective box left the built tree: a refitted node, and each inner child it
 * requantizes. Only those can enter a ray the built tree kept out, so they bound the extra
 * steps a moved tree may take. Kept once marked: a settled pose keeps the refitted topology.
 */
function createGrowth(nodeCount: number) {
  const grown = new Uint8Array(nodeCount)
  let count = 0
  return {
    grown,
    grow: (node: number) => {
      if (!grown[node]) count++
      grown[node] = 1
    },
    count: () => count,
  }
}

/** Refit the existing wide topology; triangles and their order never change. */
export function createProxyRefit(data: SceneProxyColumns) {
  const { triangles, triangleGroups, groupOffsets, nodeBounds, nodeChildren } = data
  const { starts, slots } = groupSlots(groupOffsets.length, triangleGroups)
  const bounds = proxyTriangleBoxes(triangles)
  const errors = new Float64Array(triangleGroups.length * 3)
  const changed = new Uint8Array(triangleGroups.length)
  const nodeChanged = new Uint8Array(nodeBounds.length / 6)
  const { leafNode, shared } = indexLeaves(nodeChildren, triangleGroups.length),
    leafDirty = new Uint8Array(nodeChanged.length)
  const { grown, grow, count: grownNodes } = createGrowth(nodeChanged.length)
  const boxes = new Float64Array(24)
  const refit = (groups: ReadonlySet<number>, transforms: Float32Array, extent: number[]) => {
    changed.fill(0)
    nodeChanged.fill(0)
    leafDirty.fill(0)
    for (const group of groups)
      for (let rank = starts[group]; rank < starts[group + 1]; rank++) {
        const t = slots[rank]
        changed[t] = 1
        if (leafNode[t] !== NO_LEAF) leafDirty[leafNode[t]] = 1
        moveTriangle(data, bounds, errors, transforms, group, t)
      }
    for (let node = nodeChanged.length - 1; node >= 0; node--) {
      const dirty =
        leafDirty[node] === 1 || childMoved(nodeChildren, nodeChanged, changed, shared, node)
      if (!dirty) continue
      nodeChanged[node] = 1
      grow(node)
      const base = node * 6
      nodeBounds.fill(Infinity, base, base + 3)
      nodeBounds.fill(-Infinity, base + 3, base + 6)
      fitChildren(nodeChildren, nodeBounds, bounds, errors, boxes, node)
      quantizeChildren(nodeChildren, nodeBounds, boxes, node, grow)
    }
    // Tight geometry extent drives the existing cascade planner, not padded traversal boxes.
    proxyBoxesExtent(bounds, triangleGroups.length, extent)
  }
  return Object.assign(refit, {
    /** World bounds of each triangle over all its owners, six per triangle, and the moved ones. */
    boxes: bounds,
    changed,
    /** Triangles of each group: `slots[starts[g]]` to `slots[starts[g + 1] - 1]`. */
    starts,
    slots,
    /** Nodes a ray may visit beyond the built tree's, since the first motion. */
    grownNodes,
    bytes: byteLengths(
      errors,
      bounds,
      changed,
      leafNode,
      leafDirty,
      nodeChanged,
      grown,
      boxes,
      starts,
      slots,
    ),
  })
}
