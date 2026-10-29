// The bind groups of an instance: one for each pipeline that draws it, made at the first draw and kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import { instanceGroups } from './ribbonBinds.ts'

test('a pipeline takes its group at its first draw and keeps it, however many pipelines take turns', () => {
  let made = 0
  const device = {
    createBindGroup: (descriptor: { layout: unknown }) => ({
      made: ++made,
      layout: descriptor.layout,
    }),
  } as unknown as GPUDevice
  const buffer = (label: string) => ({ label }) as unknown as GPUBuffer
  const group = instanceGroups(device, buffer('points'), buffer('tangents'), buffer('block'))
  const pipelines = Array.from(
    { length: 20 },
    (_, k) => ({ getBindGroupLayout: () => k }) as unknown as GPUComputePipeline,
  )
  const first = pipelines.map((pipeline) => group(pipeline))
  assert.equal(made, 20)
  assert.deepEqual(
    pipelines.map((pipeline) => group(pipeline)),
    first,
  )
  assert.equal(made, 20)
})
