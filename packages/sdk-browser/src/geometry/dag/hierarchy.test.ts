// The one builder's nodes (`page-codec-wasm/src/culling.rs`, through `cullingInPlace`) carry what the
// descent's ceiling test reads: the largest replacement error below, the sphere enclosing every
// band, and -1 over a subtree holding a cluster nothing replaces.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cullingInPlace } from './culling.fixture.ts'
import {
  CULL_CEIL,
  CULL_CHILD_COUNT,
  CULL_FIRST_CHILD,
  CULL_FIRST_PAGE,
  CULL_PAGE_COUNT,
  CULL_SPHERE,
} from './types.ts'

type Tree = ReturnType<typeof cullingInPlace>

/** The children of node `n`. */
function children(tree: Tree, n: number) {
  const base = n * tree.stride
  const first = tree.nodes[base + CULL_FIRST_CHILD]
  return Array.from({ length: tree.nodes[base + CULL_CHILD_COUNT] }, (_, c) => first + c)
}

/** The pages under node `n`, its leaves' ranks. */
function pagesUnder(tree: Tree, n: number): number[] {
  const base = n * tree.stride
  if (tree.nodes[base + CULL_CHILD_COUNT] > 0)
    return children(tree, n).flatMap((child) => pagesUnder(tree, child))
  const first = tree.nodes[base + CULL_FIRST_PAGE]
  return Array.from({ length: tree.nodes[base + CULL_PAGE_COUNT] }, (_, k) => first + k)
}

/** A page on the x axis, replaced by a band twice its radius. */
const page = (i: number, parentError: number | null) => ({
  min: [i - 1, -1, -1],
  max: [i + 1, 1, 1],
  sphere: [i, 0, 0, 1],
  lodError: 0.01,
  parentError,
  parentSphere: parentError === null ? null : [i, 0, 0, 2],
})

/** Ceiling and LOD ball of node `n`. */
function replacement(tree: Tree, n: number) {
  const base = n * tree.stride
  return {
    ceil: tree.nodes[base + CULL_CEIL],
    sphere: Array.from(tree.nodes.subarray(base + CULL_SPHERE, base + CULL_SPHERE + 4)),
  }
}

test('the ceiling is the largest replacement error, the sphere encloses every band', () => {
  const pages = Array.from({ length: 40 }, (_, i) => page(i, 0.02 + i * 0.001))
  const tree = cullingInPlace(pages)
  const root = replacement(tree, 0)
  assert.equal(root.ceil, 0.02 + 39 * 0.001)
  const [cx, cy, cz, r] = root.sphere
  // The ball of balls, in single precision, takes the larger of two nested within 1e-4 of their
  // squared distance: a hundredth at most outside.
  for (const { parentSphere } of pages) {
    const [x, y, z, radius] = parentSphere!
    assert.ok(Math.hypot(x - cx, y - cy, z - cz) + radius <= r + 1e-2, `band at ${x} outside`)
  }
  // Each child keeps the largest error of the pages under it, never more than the root's.
  for (const child of children(tree, 0)) {
    const own = pagesUnder(tree, child).map((k) => pages[k].parentError!)
    assert.equal(replacement(tree, child).ceil, Math.max(...own))
  }
})

test('a subtree holding a cluster nothing replaces certifies nothing', () => {
  const pages = Array.from({ length: 40 }, (_, i) => page(i, i === 35 ? null : 0.02))
  const tree = cullingInPlace(pages)
  const holder = pages.findIndex((p) => p.parentError === null)
  assert.equal(replacement(tree, 0).ceil, -1, 'the root holds it')
  for (const child of children(tree, 0)) {
    const holds = pagesUnder(tree, child).includes(holder)
    assert.equal(replacement(tree, child).ceil, holds ? -1 : 0.02)
  }
})
