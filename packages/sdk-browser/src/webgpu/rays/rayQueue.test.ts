// The ray query's queue on the kit's device (`createRayQueue`): a cast answers a promise and does
// nothing on the caller's path — no command, no staging, no wait —; every ray cast in one tick is
// traced by one dispatch a range of placements, in one command buffer, after the deformation index;
// the hits come back through a mapping no caller awaits, and no queue fence is ever asked; a split
// world's trace binds no more storage buffers than every device holds, the worlds and the placement
// tree read in the culling's record tables.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createRayQueue } from './rayQueue.ts'

/** A session's tables on the kit's device, as the queue reads them: one placement, two rows, its
 *  nodes in `parts` parts and its placements in `ranges` ranges. */
function rig(parts = 1, rangeCount = 1) {
  const gpu = fakeDevice()
  const buffer = (label: string) =>
    gpu.device.createBuffer({
      label,
      size: 4096,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  const split = (label: string, count: number) => ({
    buffers: Array.from({ length: count }, () => buffer(label)),
    bytes: count > 1 ? 4096 : Number.MAX_SAFE_INTEGER,
  })
  // The culling's record tables, read where they lie: the worlds and the placement tree.
  const view = (label: string) =>
    gpu.device
      .createTexture({
        label,
        size: [1, 1, 1],
        format: 'rgba32uint',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView({ dimension: '2d-array' })
  const tables = {
    ...{ nodeParts: split('nodes', parts), worlds: view('worlds'), tree: view('tree') },
    treeRoot: NO_INDEX,
    ...{ placements: rangeCount, worldPlacement: NO_INDEX, cutLinks: [] },
    ...{ recordShift: new Uint32Array(rangeCount), recordCount: 1 },
  }
  const ranges = Array.from({ length: rangeCount }, (_, r) => ({
    ...{ first: r, count: 1, frames: buffer('frames') },
  }))
  const rows = { packedCount: 2, rowsRevision: 0, offsetOf: () => -1 }
  const rt = {
    run: { lost: false, gpuSelection: { cutTables: () => tables, worldRanges: ranges } },
    gpu: { cache: { buffer: buffer('pool') } },
    vis: { pageTable: buffer('pages'), concatPos: buffer('positions'), zeroFlags: buffer('zero') },
    layout: { rows, selectionRoots: [], packedPages: [], recordOf: () => undefined },
    blendState: {},
  } as unknown as WebgpuPagesRuntime
  return { gpu, queue: createRayQueue(rt, gpu.device) }
}

const ray = (x: number) => new Ray(new Vector3(x, 0, 5), new Vector3(0, 0, -1))
const landed = () => new Promise((settled) => setTimeout(settled, 0))

test('a cast answers a promise and leaves the caller at once: no command, no staging, no wait', async () => {
  const { gpu, queue } = rig()
  const submits = gpu.submits.length,
    buffers = gpu.buffers.length
  const answer = queue.cast(ray(0))
  assert.ok(answer instanceof Promise)
  assert.equal(gpu.submits.length, submits, 'nothing submitted on the caller’s path')
  assert.equal(gpu.buffers.length, buffers, 'no staging made on the caller’s path')
  assert.equal(await answer, null, 'a hit record the GPU left empty answers none')
  assert.equal(gpu.fences(), 0, 'no queue fence asked')
  queue.dispose()
})

test('every ray of a tick is traced by one dispatch, after the row index, in one command buffer', async () => {
  const { gpu, queue } = rig()
  const answers = [queue.cast(ray(0)), queue.cast(ray(1)), queue.cast(ray(2))]
  assert.deepEqual(await Promise.all(answers), [null, null, null])
  const entries = gpu.dispatches.map(({ entryPoint }) => entryPoint)
  assert.deepEqual(entries, ['indexDeformed', 'traceRays'], 'one index, one trace, for three rays')
  assert.equal(gpu.submits.length, 1, 'one command buffer')
  assert.equal(gpu.fences(), 0)
  queue.dispose()
})

test('a filter that lists no object answers none at once, and a dispose answers what is queued', async () => {
  const { gpu, queue } = rig()
  assert.equal(await queue.cast(ray(0), { objects: [] }), null)
  const queued = queue.cast(ray(0))
  queue.dispose()
  assert.equal(await queued, null)
  await landed()
  assert.equal(gpu.submits.length, 0, 'nothing traced for a disposed queue')
})

test('a split world is traced a range a dispatch, each binding no more than eight storage buffers', async () => {
  const { gpu, queue } = rig(3, 4)
  assert.equal(await queue.cast(ray(0)), null)
  const traces = gpu.dispatches.filter(({ entryPoint }) => entryPoint === 'traceRays')
  assert.equal(traces.length, 4, 'one dispatch a range')
  const bufferOf = (entry: GPUBindGroupEntry) =>
    (entry.resource as Partial<GPUBufferBinding>).buffer as { label?: string } | undefined
  const nodes = gpu.bindGroups.find((group) =>
    [...group.entries].some((e) => bufferOf(e)?.label === 'nodes'),
  )!
  const buffers = (group: GPUBindGroupDescriptor) => [...group.entries].filter(bufferOf).length
  // The last range's own group: its uniform slot, then its storage buffers.
  const own = gpu.bindGroups.at(-1)!
  assert.equal(buffers(nodes), 3, 'the nodes in their three parts')
  assert.equal(
    [...nodes.entries].length - buffers(nodes),
    2,
    'the worlds and the tree, two textures',
  )
  assert.ok(buffers(nodes) + buffers(own) - 1 <= 8)
  queue.dispose()
})
