// The kit refuses what the device refuses (`usageScope.ts`): a dispatch reading its arguments from
// a buffer a group set binds writable, a render pass drawing from one any of its groups binds
// writable — the encoder the shadow chunks once finished, which lost the device on every page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageScope, recordingEncoder, writableBuffers } from './usageScope.ts'
import { mockGpu } from './mockGpu.ts'

const args = { label: 'args' },
  other = { label: 'other' }
const layout = {
  entries: [
    { binding: 0, buffer: { type: 'uniform' } },
    { binding: 1, buffer: { type: 'read-only-storage' } },
    { binding: 2, buffer: { type: 'storage' } },
  ],
}
/** A group binding `read` read-only at 1 and `write` writable at 2. */
const group = (read: object, write: object) => ({
  layout,
  entries: [
    { binding: 0, resource: { buffer: other } },
    { binding: 1, resource: { buffer: read } },
    { binding: 2, resource: { buffer: write } },
  ],
})
const REFUSED = /usage \(Indirect\|Storage\(read-write\)\) includes writable usage/

test('only the storage entries of a group bind writable', () => {
  assert.deepEqual(writableBuffers(group(args, other)), [other])
  assert.deepEqual(writableBuffers(group(other, args)), [args])
})

test('a dispatch may not read its arguments from a buffer it binds writable', () => {
  const ok = createUsageScope('compute')
  ok.setBindGroup(0, group(args, other))
  ok.indirect(args, 'reads it read-only')
  const scope = createUsageScope('compute')
  scope.setBindGroup(0, group(other, args))
  assert.throws(() => scope.indirect(args, 'writes it'), REFUSED)
  // Another group set in its place frees the next dispatch.
  scope.setBindGroup(0, group(args, other))
  scope.indirect(args, 'after')
})

test('a render pass may not draw from a buffer any of its groups binds writable', () => {
  const scope = createUsageScope('render')
  scope.setBindGroup(0, group(other, args))
  scope.setBindGroup(0, group(args, other))
  scope.indirect(args, 'draw')
  assert.throws(() => scope.end(), REFUSED, 'the pass is one scope: the first group counts')
})

test('the recording encoder and the mock GPU refuse it where they encode', () => {
  const { encoder } = recordingEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline({ entryPoint: 'k' } as unknown as GPUComputePipeline)
  pass.setBindGroup(0, group(other, args) as unknown as GPUBindGroup)
  assert.throws(() => pass.dispatchWorkgroupsIndirect(args as GPUBuffer, 0), REFUSED)
  const { device } = mockGpu()
  const buffer = device.createBuffer({ label: 'args', size: 64, usage: 0x180 })
  const bound = { layout, entries: [{ binding: 2, resource: { buffer } }] }
  const mock = device.createCommandEncoder().beginComputePass()
  mock.setBindGroup(0, bound as unknown as GPUBindGroup)
  assert.throws(() => mock.dispatchWorkgroupsIndirect(buffer, 0), REFUSED)
  const render = device.createCommandEncoder().beginRenderPass({ colorAttachments: [] })
  render.setBindGroup(0, bound as unknown as GPUBindGroup)
  render.drawIndirect(buffer, 0)
  assert.throws(() => render.end(), REFUSED)
})

test('a group set with other dynamic offsets than its layout’s dynamic buffers is refused', () => {
  const dynamic = {
    label: 'dyn',
    entries: [{ binding: 0, buffer: { type: 'uniform', hasDynamicOffset: true } }],
  }
  const scope = createUsageScope('compute')
  scope.setBindGroup(0, { layout: dynamic, entries: [] }, [256])
  assert.throws(
    () => scope.setBindGroup(0, { layout: dynamic, entries: [] }),
    /dynamic offsets \(0\) does not match the number of dynamic buffers \(1\)/,
  )
  assert.throws(
    () => scope.setBindGroup(0, { layout, entries: [] }, [0]),
    /dynamic offsets \(1\) does not match the number of dynamic buffers \(0\)/,
  )
  // The recording encoder and the mock GPU check it where they encode.
  const pass = recordingEncoder().encoder.beginComputePass()
  assert.throws(() => pass.setBindGroup(0, { layout } as unknown as GPUBindGroup, [0]))
  const mock = mockGpu().device.createCommandEncoder().beginComputePass()
  assert.throws(() => mock.setBindGroup(0, { layout } as unknown as GPUBindGroup, [0]))
})

test('an indirect buffer without the INDIRECT usage, an unset or other group are refused', () => {
  const scope = createUsageScope('compute')
  const plain = { label: 'plain', usage: 0x80 }
  assert.throws(() => scope.indirect(plain, 'k'), /doesn't include BufferUsage::Indirect/)
  scope.indirect({ label: 'ok', usage: 0x100 }, 'k')
  const other = { label: 'other', entries: [{ binding: 0, buffer: { type: 'storage' } }] }
  scope.pipeline({ layout: { bindGroupLayouts: [layout, other] } })
  scope.setBindGroup(0, group(args, args))
  assert.throws(() => scope.dispatch('k'), /bind group 1 is not set/)
  scope.setBindGroup(1, group(args, args))
  assert.throws(() => scope.dispatch('k'), /layout of bind group 1 does not match/)
  scope.setBindGroup(1, { layout: other, entries: [] })
  scope.dispatch('k')
})
