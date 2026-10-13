// The refit pass reads and writes the tree in its record table, bound once as a storage texture
// read and written in place (`treeTable.ts`), the frames in their ranges — the pass is never
// skipped, no group is left open for want of a binding, whatever the device splits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { createTreeRefit } from './treeRefit.ts'
import { createTreeTable } from './treeTable.ts'
import { BACKEND, fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('the refit binds the tree’s record table alone, then its own tables', () => {
  installGpuGlobals()
  const packed = packDagSelection(placementField(40, 6)),
    tree = packed.placementTree!,
    { device, passes, commands } = fakeDevice({ ...BACKEND, packed })
  const groups: { layout?: unknown; entries: { binding: number; resource: unknown }[] }[] = []
  const make = device.createBindGroup.bind(device)
  device.createBindGroup = (descriptor) => (groups.push(descriptor as never), make(descriptor))
  const buffer = () =>
    device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const table = createTreeTable(device, tree)
  const refit = createTreeRefit(device, packed, tree, {
    tree: table.view,
    frames: { buffers: [buffer(), buffer()], ranges: [{ first: 0 }, { first: 800 }] },
  })
  const encoder = device.createCommandEncoder()
  refit.run(encoder, [0, 1])
  device.queue.submit([encoder.finish()])
  assert.deepEqual(
    groups[0].entries.map(({ binding, resource }) => [binding, resource]),
    [[0, table.view]],
    'the tree’s table, no node or cold part',
  )
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
