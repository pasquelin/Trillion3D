// The ray query's queue on the kit's device (`createRayQueue`): a cast answers a promise and does
// nothing on the caller's path — no command, no staging, no wait —; every ray cast in one tick is
// traced by one dispatch, in one command buffer, after the deformation index; the hits come back
// through a mapping no caller awaits, and no queue fence is ever asked; the trace binds the cut's
// nodes, frame words, worlds and placement tree as the culling's record tables, at its bindings,
// beside three storage buffers whatever the world's size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createRayQueue } from './rayQueue.ts'
import { dagBindingOf } from '../../gpu/dag/shader/bindings.fixture.ts'

/** A session's tables on the kit's device, as the queue reads them: `placements` placements, two
 *  rows, the cut's record tables one texel each. */
function rig(placements = 1) {
  const gpu = fakeDevice()
  const buffer = (label: string) =>
    gpu.device.createBuffer({
      label,
      size: 4096,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  // The culling's record tables, read where they lie.
  const view = (label: string, format: GPUTextureFormat) =>
    gpu.device
      .createTexture({ label, size: [1, 1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView({ dimension: '2d-array' })
  const tables = {
    views: {
      nodes: view('nodes', 'rgba32uint'),
      frames: view('frames', 'r32uint'),
      worlds: view('worlds', 'rgba32uint'),
      tree: view('tree', 'r32uint'),
    },
    treeRoot: NO_INDEX,
    ...{ placements, worldPlacement: NO_INDEX, cutLinks: [] },
    ...{ recordShift: new Uint32Array(placements), recordCount: 1 },
  }
  const rows = { packedCount: 2, rowsRevision: 0, offsetOf: () => -1 }
  const rt = {
    run: { lost: false, gpuSelection: { cutTables: () => tables } },
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

test("a world of any size is traced by one dispatch, its tables at the culling's bindings", async () => {
  const { gpu, queue } = rig(40_000)
  assert.equal(await queue.cast(ray(0)), null)
  const traces = gpu.dispatches.filter(({ entryPoint }) => entryPoint === 'traceRays')
  assert.equal(traces.length, 1, 'one dispatch whatever the placements')
  // A view names its texture (`tests/kit/gpu/fakeResources.ts`), a binding its buffer.
  const labelOf = (entry: GPUBindGroupEntry) =>
    (entry.resource as { texture?: { label?: string } }).texture?.label ??
    (entry.resource as Partial<GPUBufferBinding>).buffer?.label
  const tables = gpu.bindGroups.find((group) =>
    [...group.entries].some((e) => labelOf(e) === 'nodes'),
  )!
  const culling = dagBindingOf()
  assert.deepEqual(
    Object.fromEntries([...tables.entries].map((e) => [labelOf(e), e.binding])),
    { nodes: culling.nodes, frames: culling.frames, worlds: culling.worlds, tree: culling.tree },
    "the four record tables, each at the culling's binding",
  )
  // The trace's own group: its uniform, then its three storage buffers.
  assert.equal([...gpu.bindGroups.at(-1)!.entries].length, 4)
  queue.dispose()
})
