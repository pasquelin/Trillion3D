// A cut sends its node table once at creation: the packing writes each node's open count with
// nothing resident, the count the rule's readiness starts from, so no second whole copy follows
// when the cut's runtime opens. Proved on generated fields of placements, the bytes written to the
// nodes' record table counted on the recording device, and the table the device holds compared
// with the one the readiness leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { FakeTexture } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { textureExtent } from '../core/textureExtent.ts'
import { NODE_TABLE } from './nodeTable.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { createDagReadiness } from './readiness.ts'
import { placementField } from './placementTree.fixture.ts'

for (const side of [1, 4, 12])
  test(`${side * side} placements: the node table is written once, as the rule reads it`, async () => {
    const roots = placementField(side, 6)
    const dag = packDagSelection(roots)
    const fake = fakeDevice({ limits: { maxBufferSize: 1 << 28 } })
    const cut = await createGpuDagSelection(fake.device, dag)
    assert.ok(cut, 'the cut is made')
    const writes = fake.textureWrites.filter(
      ({ destination }) => destination.texture.label === NODE_TABLE.label,
    )
    const texels = writes.reduce((sum, { size }) => {
      const [width, rows, layers] = textureExtent(size)
      return sum + width * rows * layers
    }, 0)
    assert.equal(texels * 16, dag.nodes.byteLength, 'one copy of the table, no more')
    // What the device holds is what the rule's readiness leaves with nothing resident: a node a
    // record, one field, laid as the table was (`nodeTable.ts`).
    const held = (writes[0].destination.texture as unknown as FakeTexture).words!
    const fresh = packDagSelection(roots)
    createDagReadiness(fresh)
    assert.deepEqual(held.subarray(0, fresh.nodes.length), new Uint32Array(fresh.nodes.buffer))
    cut.dispose()
  })
