// The per-command kernels of the transmission (`transmissionShared.ts`) run on their own width, not
// the dispatch's tunable one: the bin holds a projected triangle a thread in the group's memory,
// which a wider `WORKGROUP_THREADS` would push past the 16 KiB every device guarantees.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from './layout.ts'
import { vsmTransmissionBinWgsl } from './transmissionBinWgsl.ts'
import { vsmTransmissionPagesWgsl } from './transmissionPagesWgsl.ts'

test('the bin and the pages kernels take the command group, never the dispatch width', () => {
  const layout = vsmLayout({ fullMapCapacity: 1 })
  for (const code of [vsmTransmissionBinWgsl(layout), vsmTransmissionPagesWgsl(layout)]) {
    assert.match(code, /@workgroup_size\(VSM_T_COMMAND_GROUP\)/)
    assert.doesNotMatch(code, /WORKGROUP_THREADS/)
  }
  assert.match(vsmTransmissionBinWgsl(layout), /tris:array<VsmTTri,VSM_T_COMMAND_GROUP>/)
})
