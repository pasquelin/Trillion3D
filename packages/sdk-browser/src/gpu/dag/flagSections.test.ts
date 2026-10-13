// A cut's flags start within one binding of the device, as they grow: a reach past it is grown
// into, never refused up front; queue 0 keeps a root slot a placement.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dagFlagShape, flagSectionCaps, grownFlagShape } from './flagSections.ts'
import { cameraCutBuffers, pastBinding } from './bufferTable.ts'
import { QUEUE_DROPPED } from './shader/viewsWgsl.ts'

const packed = { queueEntries: 1811, worldCount: 600, pageCount: 1800, candCount: 1800 }

test('a device that binds less than the reach starts each section within one binding', () => {
  const limits = { maxStorageBufferBindingSize: 12800 }
  const cap = flagSectionCaps(limits),
    shape = dagFlagShape(packed, limits)
  assert.deepEqual(cap, { queueWords: 3200, candCap: 1066 })
  assert.deepEqual(shape, { queueWords: 3200, candCap: 1066 })
  // Growth stops at the same bound: one rule for the start and the growth.
  const bounds = { entryCount: 1811, pageCount: 1800 }
  assert.equal(grownFlagShape(limits, bounds, shape, QUEUE_DROPPED), undefined)
  // Each section fits: the flags split in parts and none is past the binding.
  const table = cameraCutBuffers(
    {
      ...packed,
      nodeCount: 3,
      clusters: new Float32Array(16),
      nodes: new Float32Array(16),
      pageCones: new Float32Array(16),
    },
    limits,
  )
  assert.ok(table.parts.flags.length > 1, 'the flags split in parts')
  assert.equal(pastBinding(limits, table.rows), undefined)
})

test('a device holding the reach keeps it, and queue 0 never drops a placement’s root slot', () => {
  assert.deepEqual(dagFlagShape(packed, { maxStorageBufferBindingSize: 1 << 27 }), {
    queueWords: 3622,
    candCap: 1800,
  })
  // A binding narrower than the roots: the queue keeps them, and the fit rule refuses the device.
  const narrow = dagFlagShape(packed, { maxStorageBufferBindingSize: 2048 })
  assert.equal(narrow.queueWords, 1200)
})
