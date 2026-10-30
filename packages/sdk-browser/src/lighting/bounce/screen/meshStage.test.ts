// The kernels of the meshes' fields stage (`meshStage.ts`): they are ready once compiled, read live; and the lists of the rays are emptied together at the placement (`encode.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import { resetRayLists } from './encode.ts'
import { meshStageKernel } from './meshStage.ts'
import { traceSceneEntries } from './traceSceneWgsl.ts'

test('the meshes’ stage kernel is ready when its compaction and its trace are compiled, and says so live', async () => {
  // The trace reads the meshes' fields: more storage buffers than WebGPU's default, as the engine's device is granted.
  const gpu = fakeDevice({ limits: { maxStorageBuffersPerShaderStage: 16 } })
  const device = gpu.device as GPUDevice
  const shape = { side: 8, samples: [4, 4] as const, heightFog: false, light: WORD_LIGHT_FORMAT }
  // The scene stage's group 0, which both kernels are checked against: their shaders name only the bindings they read.
  const layout = device.createBindGroupLayout({ entries: traceSceneEntries(false, shape.light, false) })
  const kernel = meshStageKernel(device, shape, { traceScene: { layout } } as never)
  assert.equal(kernel.ready, false, 'nothing is compiled at the call')
  for (let turn = 0; turn < 20 && !kernel.ready; turn++)
    await new Promise((done) => setImmediate(done))
  assert.equal(kernel.compact.ready, true)
  assert.equal(kernel.trace.ready, true)
  assert.equal(
    kernel.ready,
    true,
    'the kernel follows the compile, it is not a value taken at the call',
  )
  assert.ok(kernel.compact.pipeline() && kernel.trace.pipeline())
})

test('the placement empties the list of the rays the screen leaves and the list of the rays the meshes are traced for, from the one head', () => {
  const copies: unknown[][] = []
  const encoder = { copyBufferToBuffer: (...args: unknown[]) => void copies.push(args) }
  const [head, rays, meshes] = ['head', 'rays', 'meshes'] as unknown as GPUBuffer[]
  resetRayLists(encoder as never, { listHead: head, sceneRays: rays, meshRays: meshes })
  assert.deepEqual(copies, [
    [head, 0, rays, 0, 16],
    [head, 0, meshes, 0, 16],
  ])
})
