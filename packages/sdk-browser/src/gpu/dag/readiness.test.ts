// The cut rule's readiness over a packing counts its host tables, which the CPU total holds beside
// the decoded pages (`../../residency/memoryBudget.ts`): they follow the resident pages, never the
// catalogue (#483 rule 6).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ruleDag } from '../../page/cut/cutRule.fixture.ts'
import { stripUniforms } from '../../page/cut/cutRuleBackends.fixture.ts'
import { createDagReadiness } from './readiness.ts'
import { packDagSelection } from './pack.ts'

test('the readiness holds nothing until a page is resident, and nothing once all have left', () => {
  const dag = ruleDag(64)
  const { packed } = stripUniforms(dag, 0.1)
  const readiness = createDagReadiness(packed)
  const none = new Uint8Array(packed.pageCount)
  readiness.apply(none)
  assert.equal(readiness.hostBytes, 0)
  readiness.apply(new Uint8Array(packed.pageCount).fill(1))
  assert.ok(readiness.hostBytes > 0)
  readiness.apply(none)
  assert.equal(readiness.hostBytes, 0)
})

test('placements of one primitive hold a state of their own only while one of their pages is resident', () => {
  const dag = ruleDag(64)
  const root = {
    world: dag.world,
    pages: dag.pages,
    culling: dag.culling,
    structure: dag.structure,
  }
  const placed = createDagReadiness(packDagSelection([root, root, root]))
  const count = dag.pages.length
  const pairs = (readiness: ReturnType<typeof createDagReadiness>, base: number) =>
    Array.from({ length: count }, (_, p) => [
      readiness.isReady(base + p),
      readiness.isChildReady(base + p),
    ])
  const single = (resident: number) => {
    const readiness = createDagReadiness(stripUniforms(dag, 0.1).packed)
    readiness.apply(new Uint8Array(count).fill(resident))
    return pairs(readiness, 0)
  }
  placed.apply(new Uint8Array(count * 3))
  assert.equal(placed.heldPlacements, 0)
  placed.apply(new Uint8Array(count * 3).fill(1, count, count * 2))
  assert.equal(placed.heldPlacements, 1)
  assert.deepEqual(pairs(placed, 0), single(0))
  assert.deepEqual(pairs(placed, count), single(1))
  assert.deepEqual(pairs(placed, count * 2), single(0))
  // Its pages gone, the placement reads the shared state again and holds nothing.
  placed.apply(new Uint8Array(count * 3))
  assert.equal(placed.heldPlacements, 0)
  assert.equal(placed.hostBytes, 0)
  assert.deepEqual(pairs(placed, count), single(0))
})

test('a placement without a cluster structure reads its own state with nothing resident', () => {
  const dag = ruleDag(16)
  const root = { world: dag.world, pages: dag.pages, culling: dag.culling }
  const readiness = createDagReadiness(packDagSelection([root, root]))
  readiness.apply(new Uint8Array(dag.pages.length * 2).fill(1, 0, 1))
  assert.equal(readiness.heldPlacements, 1)
  assert.equal(readiness.isReady(0), true)
  assert.equal(readiness.isReady(dag.pages.length), false)
})
