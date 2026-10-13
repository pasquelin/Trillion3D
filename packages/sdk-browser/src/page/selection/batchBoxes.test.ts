import '../../wasm/sdkWasm.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOX_VALUES } from '../../../../sdk-core/src/index.ts'
import { createBoxTransformLot } from '../decode/batch/batchRuntime.ts'
import { emptyWorldBox } from '../../host/world/bounds.ts'
import { boxUnionCollector, reserveRootBoxes, transformRootBoxes } from './batchBoxes.ts'
import type { ClusterRoot, PageRec } from './types.ts'

const UNIT = [0, 0, 0, 1, 1, 1]
const moved = (x: number) => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1])

/** A root of the unit box, posed by `elements`, or at `x` along the first axis. */
const rootAt = (x: number, elements = moved(x)) =>
  ({
    world: { elements },
    localBox: new Float64Array(UNIT),
    worldBox: new Float64Array(BOX_VALUES),
  }) as unknown as ClusterRoot<PageRec>

test('a root lot that no longer holds the roots is remade at their count, never handed to a loop', async () => {
  const first = moved(1)
  const roots = [rootAt(1, first), rootAt(2)]
  const lot = await reserveRootBoxes(roots)
  assert.ok(lot)
  assert.deepEqual(Array.from(roots[1].worldBox!), [2, 0, 0, 3, 1, 1], 'the first run')
  roots.push(rootAt(3))
  first.set(moved(5))
  const remade = transformRootBoxes(lot, roots, [0, 2], 2)
  assert.ok(remade && remade !== lot)
  assert.equal(remade.n, 3)
  assert.equal(lot.holds(2), false, 'the old one released')
  assert.deepEqual(Array.from(roots[0].worldBox!), [5, 0, 0, 6, 1, 1])
  assert.deepEqual(Array.from(roots[2].worldBox!), [3, 0, 0, 4, 1, 1])
  assert.deepEqual(Array.from(roots[1].worldBox!), [2, 0, 0, 3, 1, 1], 'a root not moved')
  assert.equal(transformRootBoxes(remade, roots, [1], 1), remade, 'kept while it holds them')
  remade.release()
})

test('a root without boxes is passed, the others moved', async () => {
  const bare = { world: { elements: moved(9) } } as unknown as ClusterRoot<PageRec>
  const roots = [bare, rootAt(4)]
  const lot = await reserveRootBoxes(roots)
  assert.ok(lot)
  assert.deepEqual(Array.from(roots[1].worldBox!), [4, 0, 0, 5, 1, 1])
  lot.release()
})

test('a union of boxes a lot of another size cannot hold is taken in a lot of its own', async () => {
  const other = await createBoxTransformLot(5)
  assert.ok(other)
  for (const lot of [other, null]) {
    const union = boxUnionCollector(emptyWorldBox(), lot, 2)
    for (const x of [1, 2]) {
      union.boxes.set(UNIT, union.at)
      union.pose(moved(x))
    }
    assert.deepEqual(Array.from(union.close()), [1, 0, 0, 3, 1, 1])
  }
  assert.equal(other.holds(5), true, 'the lot of another size is left as it was')
  other.release()
})

test('a union of no box is the box it was handed', () => {
  const into = emptyWorldBox()
  assert.equal(boxUnionCollector(into, null, 0).close(), into)
})
