// A camera cut whose flags pass one binding makes them in parts, binds each at once, and hands its
// mask readers the draw mask, a bit a page in `work`, at its offset there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { DAG_BINDING, dagPartBindings } from './shader/bindings.ts'
import { dagPartCounts } from './split.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { packed } from './selectionHelpers.fixture.ts'
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('flags past one binding: parts, all bound, the mask in `work`', async () => {
  const { dag } = packed(dagFixture())
  // The live list, three words a page here, the widest section (`liveWgsl.ts`).
  const words = Math.max(3 * dag.pageCount, dag.nodeCount, dag.worldCount)
  const limit = Math.max(96, 4 * words)
  const fake = fakeDevice({
    limits: {
      ...SHADOW_LIMITS,
      maxStorageBufferBindingSize: limit,
      maxStorageBuffersPerShaderStage: 64,
    },
  })
  const resources = (await createDagResources(fake.device, dag))!
  assert.ok(resources.flagParts.length > 1, 'flags in parts')
  for (const part of resources.flagParts) assert.ok(part.size <= limit, 'each within a binding')
  const extra = dagPartBindings(dagPartCounts(resources.split)).map(({ binding }) => binding)
  // The selection's group, the one that binds the primitive range (the arming kernel's does not).
  const groups = fake.bindGroups.map((group) => [...group.entries].map(({ binding }) => binding))
  const bound = groups.filter((bindings) => bindings.includes(DAG_BINDING.range)).at(-1)!
  for (const binding of extra) assert.ok(bound.includes(binding), `binding ${binding} bound`)

  const selection = createDagRuntime(resources)
  assert.equal(selection.maskBuffer, resources.work, 'the mask is in `work`')
  assert.ok((selection.maskOffset + Math.ceil(dag.pageCount / 32)) * 4 <= selection.maskBuffer.size)
})
