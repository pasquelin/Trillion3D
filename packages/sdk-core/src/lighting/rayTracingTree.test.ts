import test from 'node:test'
import assert from 'node:assert/strict'
import { RAY_TRACING_NODE_BYTES, RAY_TRACING_STACK } from '../contracts/rayTracingAbi.ts'
import { rayTracingTreeOf, treeTriangles, type RayTracingTree } from './rayTracingTree.ts'

/** A grid of `n × n` quads in the plane z = height, two triangles each, one metre a side. */
function grid(n: number, height = 0) {
  const positions: number[] = []
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) positions.push(x, y, height + ((x * 7 + y * 3) % 5) * 0.01)
  const indices: number[] = []
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x
      indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1)
    }
  return { positions, indices }
}

/** Every triangle the walk of `tree` reaches from its root, by the triangle's rank in the mesh, the boxes it must lie in on the way down. */
function walk(tree: RayTracingTree) {
  const bytes = new DataView(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.byteLength)
  const floats = new Float32Array(
    tree.triangles.buffer,
    tree.triangles.byteOffset,
    tree.triangles.length,
  )
  const reached: number[] = []
  let deepest = 0
  const visit = (rank: number, depth: number) => {
    deepest = Math.max(deepest, depth)
    const at = rank * RAY_TRACING_NODE_BYTES
    const origin = [0, 1, 2].map((a) => bytes.getFloat32(at + 4 * a, true))
    const scale = [0, 1, 2].map((a) => 2 ** bytes.getInt8(at + 12 + a))
    const mask = bytes.getUint8(at + 15)
    const childBase = bytes.getUint32(at + 16, true)
    const triangleBase = bytes.getUint32(at + 20, true)
    let inner = 0
    for (let slot = 0; slot < 8; slot++) {
      const meta = bytes.getUint8(at + 24 + slot)
      const box = (end: number) =>
        [0, 1, 2].map(
          (a) => origin[a] + scale[a] * bytes.getUint8(at + 32 + end * 24 + 8 * a + slot),
        )
      const [low, high] = [box(0), box(1)]
      if ((mask >> slot) & 1) visit(childBase + inner++, depth + 1)
      else if (meta !== 0) {
        const count = meta >> 5,
          first = triangleBase + (meta & 31)
        for (let k = 0; k < count; k++) {
          const t = (first + k) * 12
          reached.push(tree.triangles[t + 10])
          for (let c = 0; c < 9; c++)
            assert.ok(
              floats[t + c] >= low[c % 3] - 1e-6 * Math.max(1, Math.abs(low[c % 3])) &&
                floats[t + c] <= high[c % 3] + 1e-6 * Math.max(1, Math.abs(high[c % 3])),
              'a corner of a leaf lies in its child box',
            )
        }
      }
    }
  }
  visit(0, 0)
  return { reached, deepest }
}

test("one triangle is the one leaf child of the one node, its box the triangle's", () => {
  const tree = rayTracingTreeOf([0, 0, 0, 2, 0, 0, 0, 4, 0], [0, 1, 2])!
  assert.equal(tree.nodes.length * 4, RAY_TRACING_NODE_BYTES)
  assert.deepEqual([...tree.low], [0, 0, 0])
  assert.deepEqual([...tree.high], [2, 4, 0])
  const bytes = new DataView(tree.nodes.buffer)
  // The mask of internal children is empty, the first slot's meta is one triangle at offset 0.
  assert.equal(bytes.getUint8(15), 0)
  assert.equal(bytes.getUint8(24), 1 << 5)
  assert.deepEqual([...walk(tree).reached], [0])
  // A flat axis takes the least exponent; the others a power of two whose 255 steps span the side.
  assert.equal(bytes.getInt8(14), -126)
  assert.equal(bytes.getInt8(12), -6)
  assert.equal(bytes.getInt8(13), -5)
  assert.equal(tree.triangles.length * 4, 48)
})

test('every triangle of a mesh is held once, in a leaf whose box holds its corners', () => {
  const { positions, indices } = grid(20)
  const tree = rayTracingTreeOf(positions, indices)!
  const { reached, deepest } = walk(tree)
  assert.equal(reached.length, indices.length / 3)
  assert.deepEqual(
    [...reached].sort((a, b) => a - b),
    Array.from({ length: indices.length / 3 }, (_, k) => k),
  )
  assert.ok(deepest < RAY_TRACING_STACK)
  assert.ok(tree.nodes.length * 4 < RAY_TRACING_NODE_BYTES * 800)
})

test('a mesh with no triangle has no tree', () => {
  assert.equal(rayTracingTreeOf([0, 0, 0], []), undefined)
})

test('thirteen triangles on one point are halved, all of them held', () => {
  const positions = [1, 1, 1, 1, 1, 1, 1, 1, 1]
  const tree = rayTracingTreeOf(
    positions,
    Array.from({ length: 39 }, (_, k) => k % 3),
  )!
  assert.equal(walk(tree).reached.length, 13)
})

test("the box is the mesh's", () => {
  const { positions, indices } = grid(4, 3)
  const tree = rayTracingTreeOf(positions, indices)!
  assert.deepEqual([...tree.low], [0, 0, 3])
  assert.equal(tree.high[0], 4)
  assert.equal(tree.high[1], 4)
})

/** The exponent a side of `extent` takes: the least whose 255 steps span it. */
const exponentOf = (extent: number) => {
  let e = Math.ceil(Math.log2(extent / 255))
  while (2 ** e * 255 < extent) e++
  return e
}
/** The exponents of the three axes of the root node of `tree`. */
const exponents = (tree: RayTracingTree) =>
  [0, 1, 2].map((a) => new DataView(tree.nodes.buffer).getInt8(12 + a))

test('a box flat along an axis takes the least exponent there, and its triangles still lie in their child boxes', () => {
  const tree = rayTracingTreeOf([0, 0, 5, 8, 0, 5, 0, 8, 5], [0, 1, 2])!
  assert.deepEqual(exponents(tree), [exponentOf(8), exponentOf(8), -126])
  assert.deepEqual([...walk(tree).reached], [0])
})

test('a very small and a very large box take the exponents their sides need, their child boxes rounded outwards over their triangles', () => {
  for (const side of [1e-30, 3e-3, 4e4, 1e30]) {
    const { positions, indices } = grid(6)
    const scaled = Float32Array.from(positions, (p) => p * side)
    const tree = rayTracingTreeOf(scaled, indices)!
    const extent = (a: number) => {
      const axis = Array.from(scaled).filter((_, k) => k % 3 === a)
      return Math.max(...axis) - Math.min(...axis)
    }
    assert.deepEqual(
      exponents(tree),
      [0, 1, 2].map((a) => exponentOf(extent(a))),
    )
    // `walk` checks that each leaf's corners lie in the child box the bytes decode to, so a box rounded inwards fails.
    assert.equal(walk(tree).reached.length, 72)
  }
})

test('a node with a cut known to be cheapest splits two far clusters apart', () => {
  // Two clusters of four triangles a hundred metres apart: whatever else is cut, no child box spans both.
  const positions: number[] = [],
    indices: number[] = []
  for (const x0 of [0, 100])
    for (let t = 0; t < 4; t++) {
      const v = positions.length / 3
      positions.push(x0 + t * 0.1, 0, 0, x0 + t * 0.1 + 1, 0, 0, x0 + t * 0.1, 1, 0)
      indices.push(v, v + 1, v + 2)
    }
  const tree = rayTracingTreeOf(positions, indices)!
  const bytes = new DataView(tree.nodes.buffer)
  const origin = bytes.getFloat32(0, true)
  const scale = 2 ** bytes.getInt8(12)
  let children = 0
  for (let slot = 0; slot < 8; slot++) {
    const low = origin + scale * bytes.getUint8(32 + slot)
    const high = origin + scale * bytes.getUint8(56 + slot)
    if ((bytes.getUint8(15) >> slot) & 1 || bytes.getUint8(24 + slot)) {
      children++
      assert.ok(!(low < 50 && high > 50), 'a child box spans the gap between the clusters')
    }
  }
  assert.ok(children >= 2)
})

/** `count` triangles of a mesh whose centres crowd near the origin, a seeded draw: some cheapest trees need a deeper walk than halves. */
function crowded(count: number) {
  let seed = 11
  const draw = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const positions: number[] = []
  for (let t = 0; t < count; t++) {
    const at = [0, 1, 2].map(() => draw() ** 4 * 1000)
    for (let k = 0; k < 3; k++) positions.push(...at.map((c) => c + draw() * 0.01))
  }
  return { positions, indices: Array.from({ length: count * 3 }, (_, k) => k) }
}

test('a tree the walk would not hold is built again split in halves, and none where that would not hold either', () => {
  const { positions, indices } = crowded(300)
  const held = rayTracingTreeOf(positions, indices)!
  // The least stack some tree of the mesh needs: below it, none.
  const least = [...Array(64).keys()].find((stack) => rayTracingTreeOf(positions, indices, stack))!
  assert.equal(rayTracingTreeOf(positions, indices, least - 1), undefined)
  const halves = rayTracingTreeOf(positions, indices, least)!
  // Here the cheapest cuts need more than the halves do: the tree made at the least stack is the one split in halves.
  assert.notDeepEqual([...halves.nodes], [...held.nodes])
  assert.equal(walk(halves).reached.length, 300)
})

test('an index out of the vertices, a corner that is not a number, or a mesh that is not triples is a range error', () => {
  const corners = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  assert.throws(() => rayTracingTreeOf(corners, [0, 1, 3]), RangeError)
  assert.throws(() => rayTracingTreeOf(corners, [0, 1, -1]), RangeError)
  assert.throws(() => rayTracingTreeOf(corners, [0, 1, 1.5]), RangeError)
  assert.throws(() => rayTracingTreeOf(corners, [0, 1]), RangeError)
  assert.throws(() => rayTracingTreeOf([...corners.slice(0, 8), NaN], [0, 1, 2]), RangeError)
  assert.throws(() => rayTracingTreeOf([...corners.slice(0, 8), Infinity], [0, 1, 2]), RangeError)
  assert.throws(() => rayTracingTreeOf([0, 0, 0, 1], [0, 0, 0]), RangeError)
})

test('the triangles of a tree are its mesh as a soup, each corner once, in the order the leaves hold them', () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]
  const indices = [0, 1, 2, 3, 4, 5]
  const tree = rayTracingTreeOf(positions, indices)!
  const soup = treeTriangles(tree)
  assert.deepEqual(Array.from(soup.indices), [0, 1, 2, 3, 4, 5])
  assert.equal(soup.positions.length, 18)
  const corners = (triangle: number) =>
    Array.from(soup.positions.subarray(9 * triangle, 9 * triangle + 9))
  const given = [positions.slice(0, 9), positions.slice(9, 18)]
  assert.deepEqual([corners(0), corners(1)].sort(), given.sort())
})
