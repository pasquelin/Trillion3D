// The ray query's queue on the kit's device (`createRayQueue`): a cast answers a promise and does
// nothing on the caller's path — no command, no staging, no wait —; every ray cast in one tick is
// traced by one dispatch of one command buffer, after the row index made over the page table; the
// hits come back through a mapping no caller awaits, and no queue fence is ever asked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createRayQueue } from './rayQueue.ts'

/** A session's tables on the kit's device, as the queue reads them: one placement, two rows. */
function rig() {
  const gpu = fakeDevice()
  const buffer = (label: string) =>
    gpu.device.createBuffer({
      label,
      size: 4096,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  const whole = (label: string) => ({ buffers: [buffer(label)], bytes: Number.MAX_SAFE_INTEGER })
  const tables = {
    ...{ nodeParts: whole('nodes'), coldParts: whole('cold'), tree: undefined },
    ...{ pageCount: 64, placements: 1, worldPlacement: NO_INDEX },
  }
  const ranges = [{ first: 0, count: 1, buffer: buffer('worlds'), frames: buffer('frames') }]
  const rt = {
    run: { lost: false, gpuSelection: { cutTables: () => tables, worldRanges: ranges } },
    gpu: { cache: { buffer: buffer('pool') } },
    vis: { pageTable: buffer('pages'), concatPos: buffer('positions') },
    layout: { rows: { packedCount: 2 }, selectionRoots: [] },
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
  assert.deepEqual(entries, ['insertRows', 'traceRays'], 'one index, one trace, for three rays')
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
