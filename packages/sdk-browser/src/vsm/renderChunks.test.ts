// S6: the shadow raster's work follows the rows the camera's cut chooses, not the rows resident.
// The GPU chooses them, so the CPU encodes the chunks the row count needs; the cull, the expand and
// the draw of a chunk read the one argument buffer the candidates' kernels write — run here in
// JavaScript on the shipped WGSL (`shaderRun`): with 200 000 rows resident and 100 chosen, every
// chunk past the first culls, expands and draws nothing. The encoder is the kit's, under the
// device's usage scopes: no dispatch reads its arguments from a buffer it binds writable.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { replayWrites } from '../../../../tests/kit/gpu/fakeRecords.ts'
import { commandArgs } from '../../../../tests/kit/gpu/fakeRenderPass.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { createVsmResources } from './resources.ts'
import { encodeVsmRender } from './renderPass.ts'
import { emptyRowSpheres } from './rowPageBound.fixture.ts'
import {
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_ARGS_WGSL,
  VSM_RENDER_CHUNK_COUNTS,
  VSM_RENDER_COUNTS_HEAD,
  VSM_RENDER_PARAMS,
  VSM_RENDER_TIER_CMDS,
  VSM_RENDER_TIER_CORNERS,
  VSM_RENDER_TIER_PAIRS,
  VSM_RENDER_TIERS,
} from './renderParamsWgsl.ts'
import { uniformStride } from '../residency/pools.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { DEFAULT_GROUP_WIDTH } from '../gpu/dispatch/grid.ts'

/** The raster of 200 000 rows under 17 sun views on `device`, encoded into `encoder`: its stats. */
function encodeRows(device: GPUDevice, encoder: GPUCommandEncoder) {
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const rows = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE })
  return encodeVsmRender(
    encoder,
    res,
    { device, lights: [{ kind: 'directional', firstId: 8192, count: 17 }] },
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
}

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
    [
      'vsmRenderChunkCounter',
      'vsmRenderArgsAt',
      'vsmRenderArgsGrid',
      'groupGrid',
      'ceilDiv',
      'vsmRenderArgsCull',
    ].concat(['vsmRenderArgsExpand', 'vsmRenderArgsDraw']),
    { ...wgslConstants(VSM_RENDER_ARGS_WGSL), GROUP_WIDTH: DEFAULT_GROUP_WIDTH, ...scope },
  )
}

test('200 000 rows resident, 100 chosen: past the first chunk, no group, no instance', () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const stats = encodeRows(device, device.createCommandEncoder())
  // The CPU knows no bound of the chosen rows below the row count: 8192 rows a chunk (2^21 pairs
  // over 256 pages), the chunks 200 000 rows need.
  assert.deepEqual([stats.chunkRows, stats.chunks], [8192, ceilDiv(200_000, 8192)])

  // What the GPU would read: the parameter slots as the writes left them, the counters of 100
  // candidates.
  const paramsBuffer = fake.buffers.find((b) => b.label === 'vsm.render.params')!
  const slots = new Uint32Array(paramsBuffer.size / 4)
  replayWrites(
    slots.buffer,
    fake.writes.filter((w) => w.buffer === (paramsBuffer as unknown as GPUBuffer)),
  )
  const slot = (c: number) => slots.subarray((c * uniformStride(device.limits)) / 4)
  const { at } = VSM_RENDER_PARAMS
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
      ...{ viewCount: slot(c)[at.viewCount], chunk: slot(c)[at.chunk] },
      ...{ chunkRows: slot(c)[at.chunkRows], chunkCount: slot(c)[at.chunkCount] },
      ...{ cmdCapacity: slot(c)[at.cmdCapacity], pairCapacity: slot(c)[at.pairCapacity] },
    })
  // u32 words: a store truncates as WGSL's integer division does (`shaderRun` divides in doubles).
  const counts = new Uint32Array(VSM_RENDER_COUNTS_HEAD + VSM_RENDER_CHUNK_COUNTS * stats.chunks)
  const args = new Uint32Array(VSM_RENDER_ARGS_STRIDE_WORDS * stats.chunks)
  const kernels = argumentKernels({ params, counts, args })
  // The views kernel listed the 17 maps with a page to draw, in the counters' word 1.
  counts[0] = 100
  counts[1] = 17
  read(0)
  kernels.vsmRenderArgsCull()

  const argsBuffer = fake.buffers.find((b) => b.label === 'vsm.render.args')
  const groups = (offset: number) => args[offset / 4] * args[offset / 4 + 1] * args[offset / 4 + 2]
  const work = new Map<number, number[]>()
  // The candidates' and the views' kernels and their argument kernel, run above, open chunk 0's
  // compute pass.
  const candidates = ['vsmRenderCandidates', 'vsmRenderViews', 'vsmRenderArgsCull']
  // Every dispatch and draw, in pass order: chunk c's compute pass 2c, its raster pass 2c + 1.
  type Call = {
    pass: number
    entryPoint?: string
    buffer?: unknown
    offset?: number
    direct?: number
  }
  const calls: Call[] = [...fake.dispatches, ...fake.draws].sort((a, b) => a.pass - b.pass)
  for (const call of calls.filter((c) => !candidates.includes(c.entryPoint!))) {
    const c = Math.floor(call.pass / 2)
    // Chunk 0's cull counted 12 commands, all of the lowest corner tier, whose expand listed 40
    // pairs.
    if (call.entryPoint === 'vsmRenderCull' && c === 0)
      counts[VSM_RENDER_COUNTS_HEAD] = counts[VSM_RENDER_COUNTS_HEAD + VSM_RENDER_TIER_CMDS] = 12
    if (call.entryPoint === 'vsmRenderExpand' && c === 0)
      counts[VSM_RENDER_COUNTS_HEAD + VSM_RENDER_TIER_PAIRS] = 40
    let done: number
    if (call.entryPoint === 'vsmRenderArgsExpand' || call.entryPoint === 'vsmRenderArgsDraw') {
      // One thread, directly: the argument kernels write the buffer the others read.
      assert.equal(call.direct, 1, call.entryPoint)
      read(c)
      kernels[call.entryPoint]()
      done = 1
    } else {
      assert.equal(call.buffer, argsBuffer, `${call.entryPoint}: the one argument buffer`)
      assert.equal(Math.floor(call.offset! / 4 / VSM_RENDER_ARGS_STRIDE_WORDS), c, 'its chunk')
      done =
        call.entryPoint === 'vsmRenderVs'
          ? args[call.offset! / 4] * args[call.offset! / 4 + 1]
          : groups(call.offset!)
    }
    work.set(c, [...(work.get(c) ?? []), done])
  }
  assert.equal(work.size, stats.chunks, 'every chunk encoded')
  // Chunk 0: 2 groups of candidates × 17 views, its argument kernel, one group binning 12
  // commands, the lowest tier's expand over them and no other tier's, the draws' argument kernel,
  // 40 pairs of the lowest tier's corners; every other chunk culls, bins, expands and draws nothing.
  const tiers = (first: number) => [first, ...Array<number>(VSM_RENDER_TIERS - 1).fill(0)]
  assert.deepEqual(work.get(0), [34, 1, 1, ...tiers(12), 1, ...tiers(40 * VSM_RENDER_TIER_CORNERS)])
  for (let c = 1; c < stats.chunks; c++)
    assert.deepEqual(work.get(c), [0, 1, 0, ...tiers(0), 1, ...tiers(0)], `chunk ${c}`)
})

test('a device aligning at 512 lays the chunks’ parameter slots 512 bytes apart', () => {
  const fake = fakeDevice({
    limits: {
      maxStorageBufferBindingSize: 1 << 27,
      maxBufferSize: 1 << 27,
      minUniformBufferOffsetAlignment: 512,
    },
  })
  const { chunks } = encodeRows(fake.device, fake.device.createCommandEncoder())
  // Every group set with a dynamic offset: the chunks' parameters, the candidates' at 0.
  const offsets = new Set(
    [...fake.computePasses, ...fake.passes]
      .flatMap(({ commands }) => commandArgs(commands, 'setBindGroup'))
      .flatMap(([, , dynamic]) =>
        (dynamic as number[] | undefined)?.length ? [(dynamic as number[])[0]] : [],
      ),
  )
  const paramsBuffer = fake.buffers.find((b) => b.label === 'vsm.render.params')!
  assert.ok(paramsBuffer.size >= chunks * 512)
  const slots = new Uint32Array(paramsBuffer.size / 4)
  replayWrites(
    slots.buffer,
    fake.writes.filter((w) => w.buffer === (paramsBuffer as unknown as GPUBuffer)),
  )
  // Chunk c's index at its word of its slot, 128 words a slot; its groups bound at c × 512.
  const { chunk } = VSM_RENDER_PARAMS.at
  for (let c = 0; c < chunks; c++) assert.equal(slots[c * 128 + chunk], c, `chunk ${c}`)
  assert.deepEqual(
    [...offsets].sort((a, b) => a - b),
    Array.from({ length: chunks }, (_, c) => c * 512),
  )
})
