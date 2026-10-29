// The meshes' fields stage of the reflections: its program declares every name it uses, its kernels compile on a device granted the storage buffers they read, and the scene stage leaves
// a ray the stage answered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import { reservedNames, unbalanced, unresolvedNames } from '../../../gpu/core/wgslNames.fixture.ts'
import { reflectionMeshKernel } from './meshes.ts'
import { REFLECTION_MESH_ANSWERED } from './meshesWgsl.ts'
import { reflectionTraceShader } from './trace.ts'
import { traceLayouts } from './traceBindings.ts'

for (const compaction of ['native', 'polyfill'] as const) {
  test(`the reflection program with the meshes' fields stage (${compaction}) declares what it uses`, () => {
    const code = reflectionTraceShader(false, false, 'none', WORD_LIGHT_FORMAT, compaction)
    assert.match(code, /fn compactReflectionMeshes\(/)
    assert.match(code, /fn traceReflectionMeshes\(/)
    assert.deepEqual(unresolvedNames(code), [])
    assert.deepEqual(reservedNames(code), [])
    assert.equal(unbalanced(code), '')
  })
}

test('the program without the stage has neither kernel, and its scene stage still leaves an answered ray', () => {
  const code = reflectionTraceShader(false, false, 'none', WORD_LIGHT_FORMAT)
  assert.doesNotMatch(code, /compactReflectionMeshes/)
  assert.ok(code.includes(`if(missed.y==${REFLECTION_MESH_ANSWERED}){return;}`))
  // The scene stage through the scene's triangles runs no meshes' stage: nothing to leave.
  assert.doesNotMatch(reflectionTraceShader(false, true, 'none', WORD_LIGHT_FORMAT), /missed\.y==/)
})

test('the stage’s kernels are ready once compiled, and say so live', async () => {
  const gpu = fakeDevice({ limits: { maxStorageBuffersPerShaderStage: 16 } })
  const device = gpu.device as GPUDevice
  const kernel = reflectionMeshKernel(device, traceLayouts(device, false), WORD_LIGHT_FORMAT)
  assert.equal(kernel.ready, false, 'nothing is compiled at the call')
  for (let turn = 0; turn < 20 && !kernel.ready; turn++)
    await new Promise((done) => setImmediate(done))
  assert.equal(kernel.compact.ready && kernel.trace.ready, true)
  assert.equal(kernel.ready, true)
  assert.ok(kernel.compact.pipeline() && kernel.trace.pipeline())
})
