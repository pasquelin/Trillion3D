import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  RAY_TRACING_FLAG_TRANSLUCENT,
} from '../contracts/rayTracingAbi.ts'
import { withRuntimeTrees } from './rayTracingRuntime.ts'
import { rayTracingTreeOf } from './rayTracingTree.ts'
import type { RayTracing } from './rayTracingFile.ts'

const quad = rayTracingTreeOf([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3])!

test('no run-time tree leaves the file as it is', () => {
  assert.equal(withRuntimeTrees(undefined, []), undefined)
  const file = { records: new Uint32Array(16) } as RayTracing
  assert.equal(withRuntimeTrees(file, []), file)
})

test('the trees of a scene made in place are its whole structure', () => {
  const made = withRuntimeTrees(undefined, [{ mesh: 5, primitive: 0, flags: 0, tree: quad }])!
  assert.equal(made.records.length, 16)
  assert.equal(made.nodes.length, quad.nodes.length)
  assert.equal(made.triangles.length, quad.triangles.length)
  assert.deepEqual([...made.records.subarray(0, 8)], [5, 0, 0, 0, 0, 1, 0, 2])
  assert.equal(made.byPrimitive.get(5)?.get(0), 0)
  assert.equal(made.world, undefined)
  assert.equal(made.actorCells, 0)
})

test("a file's records come first, a run-time record's ranks follow its nodes and triangles, a translucent one is translucent whole", () => {
  const file: RayTracing = {
    records: Uint32Array.from({ length: 32 }, (_, k) => (k % 16 === 0 ? 7 : 0)),
    nodes: new Uint32Array(40),
    triangles: new Uint32Array(36),
    byPrimitive: new Map([[7, new Map([[0, 0]])]]),
    world: undefined,
    actorCells: 0,
  }
  const made = withRuntimeTrees(file, [
    { mesh: 9, primitive: 0, flags: RAY_TRACING_FLAG_TRANSLUCENT, tree: quad },
  ])!
  assert.equal(made.records.length, 48)
  assert.deepEqual([...made.records.subarray(0, 32)], [...file.records])
  const [, , flags, , firstNode, nodeCount, firstTriangle, triangleCount] =
    made.records.subarray(32)
  assert.equal(flags, RAY_TRACING_FLAG_TRANSLUCENT | RAY_TRACING_FLAG_ALL_TRANSLUCENT)
  assert.deepEqual([firstNode, nodeCount, firstTriangle, triangleCount], [2, 1, 3, 2])
  assert.equal(made.byPrimitive.get(7)?.get(0), 0)
  assert.equal(made.byPrimitive.get(9)?.get(0), 2)
  assert.equal(file.byPrimitive.has(9), false, 'the file itself is left as it was')
})

test('a run-time primitive named as a record of the file is refused, never written over it', () => {
  const file: RayTracing = {
    records: Uint32Array.from({ length: 16 }, (_, k) => (k === 0 ? 3 : 0)),
    nodes: new Uint32Array(20),
    triangles: new Uint32Array(12),
    byPrimitive: new Map([[3, new Map([[0, 0]])]]),
    world: undefined,
    actorCells: 0,
  }
  assert.throws(
    () => withRuntimeTrees(file, [{ mesh: 3, primitive: 0, flags: 0, tree: quad }]),
    RangeError,
  )
  assert.doesNotThrow(() =>
    withRuntimeTrees(file, [{ mesh: 3, primitive: 1, flags: 0, tree: quad }]),
  )
  assert.throws(
    () =>
      withRuntimeTrees(undefined, [
        { mesh: 8, primitive: 0, flags: 0, tree: quad },
        { mesh: 8, primitive: 0, flags: 0, tree: quad },
      ]),
    RangeError,
  )
})
