import '../../wasm/sdkWasm.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoxTransformLot } from '../decode/batch/batchRuntime.ts'
import { emptyWorldBox } from '../../host/world/bounds.ts'
import { boxUnionCollector } from './batchBoxes.ts'

const UNIT = [0, 0, 0, 1, 1, 1]
const moved = (x: number) => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1])

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
