// The one builder's nodes (`page-codec-wasm/src/culling.rs`, through `cullingInPlace`) carry what the
// descent's ceiling test reads: the largest replacement error below, the sphere enclosing every
// band, and -1 over a subtree holding a cluster nothing replaces.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cullingInPlace } from './culling.fixture.ts'

/** A page on the x axis, replaced by a band twice its radius. */
const page = (i: number, parentError: number | null) => ({
  min: [i - 1, -1, -1],
  max: [i + 1, 1, 1],
  sphere: [i, 0, 0, 1],
  lodError: 0.01,
  parentError,
  parentSphere: parentError === null ? null : [i, 0, 0, 2],
})

/** Ceiling `[10]` and sphere `[6..9]` of node `n`. */
function replacement(tree: ReturnType<typeof cullingInPlace>, n: number) {
  const base = n * tree.stride
  return {
    ceil: tree.nodes[base + 10],
    sphere: Array.from(tree.nodes.subarray(base + 6, base + 10)),
  }
}

test('the ceiling is the largest replacement error, the sphere encloses every band', () => {
  const pages = Array.from({ length: 40 }, (_, i) => page(i, 0.02 + i * 0.001))
  const tree = cullingInPlace(pages)
  const root = replacement(tree, 0)
  assert.equal(root.ceil, 0.02 + 39 * 0.001)
  const [cx, cy, cz, r] = root.sphere
  for (const { parentSphere } of pages) {
    const [x, y, z, radius] = parentSphere!
    assert.ok(Math.hypot(x - cx, y - cy, z - cz) + radius <= r * (1 + 1e-9), `band at ${x} outside`)
  }
  // Each child keeps the largest error of its own pages, never more than the root's.
  for (let c = 0; c < tree.nodes[12]; c++) {
    const child = tree.nodes[11] + c,
      at = child * tree.stride,
      own = pages.slice(tree.nodes[at + 13], tree.nodes[at + 13] + tree.nodes[at + 14])
    assert.equal(replacement(tree, child).ceil, Math.max(...own.map((p) => p.parentError!)))
  }
})

test('a subtree holding a cluster nothing replaces certifies nothing', () => {
  const pages = Array.from({ length: 40 }, (_, i) => page(i, i === 35 ? null : 0.02))
  const tree = cullingInPlace(pages)
  const holder = pages.findIndex((p) => p.parentError === null)
  assert.equal(replacement(tree, 0).ceil, -1, 'the root holds it')
  for (let c = 0; c < tree.nodes[12]; c++) {
    const at = (tree.nodes[11] + c) * tree.stride,
      [first, count] = [tree.nodes[at + 13], tree.nodes[at + 14]]
    const holds = holder >= first && holder < first + count
    assert.equal(replacement(tree, tree.nodes[11] + c).ceil, holds ? -1 : 0.02)
  }
})
