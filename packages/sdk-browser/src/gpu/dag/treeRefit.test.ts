// The refit pass binds the cut's tables as the cut binds them: a table the device splits is bound
// in its parts, each at the binding `dagPartBindings` gives it, the frames in their ranges — the
// pass is never skipped, no group is left open for want of a binding.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { createTreeRefit } from './treeRefit.ts'
import { DAG_BINDING, dagPartBindings } from './shader/bindings.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('the tables of a split device are bound in their parts by the cut’s own bindings', () => {
  installGpuGlobals()
  const packed = packDagSelection(placementField(40, 6)),
    tree = packed.placementTree!,
    { device, passes, commands } = mockGpu({ packed })
  const groups: { layout?: unknown; entries: { binding: number }[] }[] = []
  const make = device.createBindGroup.bind(device)
  device.createBindGroup = (descriptor) => (groups.push(descriptor as never), make(descriptor))
  const buffer = () =>
    device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const refit = createTreeRefit(device, packed, tree, {
    nodeParts: { buffers: [buffer(), buffer(), buffer()], bytes: 100 * DAG_NODE_FLOATS * 4 },
    coldParts: { buffers: [buffer(), buffer()], bytes: 4096 * 4 },
    frames: { buffers: [buffer(), buffer()], ranges: [{ first: 0 }, { first: 800 }] },
  })
  const encoder = device.createCommandEncoder()
  refit.run(encoder, [0, 1])
  device.queue.submit([encoder.finish()])
  const tables = groups[0].entries.map(({ binding }) => binding),
    parts = dagPartBindings({ nodes: 3, cold: 2 }).map(({ binding }) => binding)
  assert.deepEqual(tables, [DAG_BINDING.nodes, DAG_BINDING.cold, ...parts], 'the cut’s bindings')
  assert.deepEqual(
    groups[1].entries.map(({ binding }) => binding),
    [0, 1, 2, 3, 4],
    'the pass’s own: parameters, ids, leaves, a buffer a range of frames',
  )
  assert.equal(passes.length + commands.length > 0, true)
  assert.ok(
    commands.some((c) => c.includes('placement tree refit')),
    'the pass is encoded',
  )
})
