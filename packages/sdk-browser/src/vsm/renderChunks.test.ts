// S6: the shadow raster's work follows the rows the camera's cut chooses, not the rows resident.
// The GPU chooses them, so the CPU encodes the chunks the row count needs; the cull, the expand and
// the draw of a chunk read the one argument buffer the candidates' kernels write — run here in
// JavaScript on the shipped WGSL (`shaderRun`): with 200 000 rows resident and 100 chosen, every
// chunk past the first culls, expands and draws nothing. The encoder is the kit's, under the
// device's usage scopes: no dispatch reads its arguments from a buffer it binds writable.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice, replayWrites } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { recordingEncoder } from '../../../../tests/kit/gpu/usageScope.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { createVsmResources } from './resources.ts'
import { encodeVsmRender } from './renderPass.ts'
import { emptyRowSpheres } from './rowPageBound.fixture.ts'
import {
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_ARGS_WGSL,
  VSM_RENDER_COUNTS_HEAD,
  VSM_RENDER_PARAMS_SLOT,
} from './renderCullWgsl.ts'

/** The argument kernels, in JavaScript, over `params`, `counts` and `args`. */
function argumentKernels(scope: {
  params: Record<string, number>
  counts: Uint32Array
  args: Uint32Array
}) {
  type Kernel = () => void
  return shaderRun<
    Record<'vsmRenderArgsCull' | 'vsmRenderArgsExpand' | 'vsmRenderArgsDraw', Kernel>
  >(
    VSM_RENDER_ARGS_WGSL,
    ['vsmRenderChunkCounter', 'vsmRenderArgsAt', 'vsmRenderWrapped', 'vsmRenderArgsCull'].concat([
      'vsmRenderArgsExpand',
      'vsmRenderArgsDraw',
    ]),
    { ...wgslConstants(VSM_RENDER_ARGS_WGSL), ...scope },
  )
}

test('200 000 rows resident, 100 chosen: past the first chunk, no group, no instance', () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const { encoder, calls } = recordingEncoder()
  const rows = device.createBuffer({ size: 16, usage: 0 })
  const stats = encodeVsmRender(
    encoder,
    res,
    { device, lights: [{ kind: 'directional', firstId: 8192, count: 17, shouldRender: true }] },
    {
      rowCount: 200_000,
      ...{ pageTable: rows, spheres: rows, mobility: rows, rowLods: rows },
      pageLayout: {} as GPUBindGroupLayout,
      pageGroup: {} as GPUBindGroup,
      rowSpheres: emptyRowSpheres(),
      camera: {
        ...{ eye: [0, 0, 0], view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        ...{ focalPixels: 600, near: 0.1, perspective: true, threshold: 1 },
      },
    },
  )!
  // The CPU knows no bound of the chosen rows below the row count: 8192 rows a chunk (2^21 pairs
  // over 256 pages), the chunks 200 000 rows need.
  assert.deepEqual([stats.chunkRows, stats.chunks], [8192, Math.ceil(200_000 / 8192)])

  // What the GPU would read: the parameter slots as the writes left them, the counters of 100
  // candidates.
  const paramsBuffer = fake.buffers.find((b) => b.label === 'vsm.render.params')!
  const slots = new Uint32Array(paramsBuffer.size / 4)
  replayWrites(
    slots.buffer,
    fake.writes.filter((w) => w.buffer === (paramsBuffer as unknown as GPUBuffer)),
  )
  const slot = (c: number) => slots.subarray((c * VSM_RENDER_PARAMS_SLOT) / 4)
  const params = {
    chunk: 0,
    chunkRows: 0,
    chunkCount: 0,
    viewCount: 0,
    cmdCapacity: 0,
    pairCapacity: 0,
  }
  const read = (c: number) =>
    Object.assign(params, {
      ...{ viewCount: slot(c)[24], chunk: slot(c)[25], chunkRows: slot(c)[27] },
      ...{ chunkCount: slot(c)[28], cmdCapacity: slot(c)[29], pairCapacity: slot(c)[30] },
    })
  // u32 words: a store truncates as WGSL's integer division does (`shaderRun` divides in doubles).
  const counts = new Uint32Array(VSM_RENDER_COUNTS_HEAD + 4 * stats.chunks)
  const args = new Uint32Array(VSM_RENDER_ARGS_STRIDE_WORDS * stats.chunks)
  const kernels = argumentKernels({ params, counts, args })
  counts[0] = 100
  read(0)
  kernels.vsmRenderArgsCull()

  const argsBuffer = fake.buffers.find((b) => b.label === 'vsm.render.args')
  const groups = (offset: number) => args[offset / 4] * args[offset / 4 + 1] * args[offset / 4 + 2]
  const work = new Map<number, number[]>()
  // The candidates' kernel and its argument kernel, run above, open chunk 0's compute pass.
  const candidates = ['vsmRenderCandidates', 'vsmRenderArgsCull']
  for (const call of calls.filter((c) => !candidates.includes(c.entry!))) {
    // Chunk c's compute pass 2c, its raster pass 2c + 1.
    const c = Math.floor(call.pass / 2)
    // Chunk 0's cull counted 12 commands, its expand 40 pairs of 3 corners.
    if (call.entry === 'vsmRenderCull' && c === 0) counts[VSM_RENDER_COUNTS_HEAD] = 12
    if (call.entry === 'vsmRenderExpand' && c === 0)
      [counts[VSM_RENDER_COUNTS_HEAD + 1], counts[VSM_RENDER_COUNTS_HEAD + 2]] = [40, 3]
    let done: number
    if (call.entry === 'vsmRenderArgsExpand' || call.entry === 'vsmRenderArgsDraw') {
      // One thread, directly: the argument kernels write the buffer the others read.
      assert.equal(call.direct, 1, call.entry)
      read(c)
      kernels[call.entry]()
      done = 1
    } else {
      assert.equal(call.buffer, argsBuffer, `${call.entry}: the one argument buffer`)
      assert.equal(Math.floor(call.offset! / 4 / VSM_RENDER_ARGS_STRIDE_WORDS), c, 'its chunk')
      done =
        call.entry === 'vsmRenderVs'
          ? args[call.offset! / 4] * args[call.offset! / 4 + 1]
          : groups(call.offset!)
    }
    work.set(c, [...(work.get(c) ?? []), done])
  }
  assert.equal(work.size, stats.chunks, 'every chunk encoded')
  // Chunk 0: 2 groups of candidates × 17 views, its argument kernel, 12 commands, the draw's
  // argument kernel, 40 pairs of 3 vertices; every other chunk culls, expands and draws nothing.
  assert.deepEqual(work.get(0), [34, 1, 12, 1, 120])
  for (let c = 1; c < stats.chunks; c++)
    assert.deepEqual(work.get(c), [0, 1, 0, 1, 0], `chunk ${c}`)
})
