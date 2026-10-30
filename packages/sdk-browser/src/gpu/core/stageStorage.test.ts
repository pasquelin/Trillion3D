import test from 'node:test'
import assert from 'node:assert/strict'
import { grantsStageStorage } from './stageStorage.ts'

const grants = (stage: 'vertex' | 'fragment' | 'compute', count: number, limits: object) =>
  grantsStageStorage({ limits } as never, stage, count)

test('a stage is granted the storage buffers the fewer of its own limit and the shader stages limit allows', () => {
  assert.equal(grants('compute', 9, { maxStorageBuffersPerShaderStage: 8 }), false)
  assert.equal(grants('compute', 9, { maxStorageBuffersPerShaderStage: 10 }), true)
  const both = { maxStorageBuffersPerShaderStage: 10, maxStorageBuffersInFragmentStage: 8 }
  assert.equal(grants('fragment', 9, both), false, 'the fragment stage has its own count')
  assert.equal(grants('vertex', 9, both), true, 'the vertex stage lists none')
  assert.equal(grants('compute', 9, both), true, 'the compute stage has no count of its own')
  assert.equal(grants('fragment', 8, {}), true, 'a device that lists none grants the guarantee')
  assert.equal(grants('fragment', 9, {}), false)
})
