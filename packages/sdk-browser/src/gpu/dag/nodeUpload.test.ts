// A cut sends its node table once at creation: the packing writes each node's open count with
// nothing resident, the count the rule's readiness starts from, so no second whole copy follows
// when the cut's runtime opens. Proved on generated fields of placements, the bytes written to the
// node buffer counted on the recording device, and the table the device holds compared with the
// one the readiness leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { createDagReadiness } from './readiness.ts'
import { placementField } from './placementTree.fixture.ts'

const NODES = 'Trillion3D DAG nodes'

for (const side of [1, 4, 12])
  test(`${side * side} placements: the node table is written once, as the rule reads it`, async () => {
    const roots = placementField(side, 6)
    const dag = packDagSelection(roots)
    const fake = fakeDevice({ limits: { maxBufferSize: 1 << 28 } })
    const cut = await createGpuDagSelection(fake.device, dag)
    assert.ok(cut, 'the cut is made')
    const writes = fake.writes.filter(({ buffer }) => buffer.label === NODES)
    const bytes = writes.reduce((sum, { data, size }) => sum + (size ?? data.byteLength), 0)
    assert.equal(bytes, dag.nodes.byteLength, 'one copy of the table, no more')
    // What the device holds is what the rule's readiness leaves with nothing resident.
    const held = new ArrayBuffer(dag.nodes.byteLength)
    replayWrites(held, writes)
    const fresh = packDagSelection(roots)
    createDagReadiness(fresh)
    assert.deepEqual(new Uint32Array(held), new Uint32Array(fresh.nodes.buffer))
    cut.dispose()
  })
