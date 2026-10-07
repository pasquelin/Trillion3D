// The resolve's frame cache on the host (`shadeCache.ts`): its buffer laid for the image's rows
// and pixels, grown and never shrunk; its header and its triangles' dispatch written each image,
// the triangles' capacity bounded by the rows and by the visibility buffer; its marks cleared by
// the first dispatch of the caller's pass, its marks and rows passes dispatched in rows of the
// device's width, its triangles pass at the size the rows pass wrote; and, without a compute
// stage, no dispatch and nothing for the pixels to read — the class pipelines then compute as
// before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createUsageScope } from '../../../../../tests/kit/gpu/usageScope.ts'
import { createShadeCache, type ShadeCacheInputs } from './shadeCache.ts'
import { createWebgpuShadePipelines } from './shadePipelines.ts'
import {
  ROW_MARK_WORDS,
  ROW_RECORD_WORDS,
  SHADE_CACHE_HEADER_WORDS,
  SHADE_ROWS_LANES,
  TRIANGLE_WORDS,
} from '../../visibility/shader/shadeCacheWgsl.ts'
/** A compute pass that records its dispatches, an indirect one as its buffer's label and offset,
 *  refused where the device would refuse it (`createUsageScope`). The cache is given the pass:
 *  it has no encoder to clear or open a pass with. */
function recorder() {
  const dispatches: unknown[][] = [],
    scope = createUsageScope('compute')
  const pass = {
    setPipeline() {},
    setBindGroup: scope.setBindGroup,
    dispatchWorkgroups: (...size: number[]) => void dispatches.push(size),
    dispatchWorkgroupsIndirect(buffer: GPUBuffer, offset: number) {
      scope.indirect(buffer, 'triangles')
      dispatches.push([buffer.label, offset])
    },
  } as unknown as GPUComputePassEncoder
  return { pass, dispatches }
}
const INPUTS = {
  vis: {},
  pages: {},
  indices: {},
  positions: {},
  uvs: {},
  normals: {},
  uniform: {},
} as unknown as ShadeCacheInputs

test('the cache is laid for the rows and the image, its passes over them in rows of groups', async () => {
  const { device, writes } = fakeDevice({
    limits: { maxComputeWorkgroupsPerDimension: 2 },
  })
  const cache = await createShadeCache(device)
  assert.deepEqual(cache.constants, { SHADE_CACHE: 1 })
  const first = cache.buffer,
    rows = 5 * SHADE_ROWS_LANES
  // Each row at most 12 triangles: 3840, under the 3900 a 26 × 6300 image holds in its texels.
  cache.layFor(rows, 36, 26, 6300)
  const laid = cache.buffer,
    capacity = rows * 12
  assert.notEqual(laid, first, 'grown for its rows')
  const rowWords = ROW_RECORD_WORDS + ROW_MARK_WORDS
  assert.equal(
    laid.size,
    (SHADE_CACHE_HEADER_WORDS + rows * rowWords + capacity * TRIANGLE_WORDS) * 4,
  )
  // The rows and the capacity, at their words, those that changed; the cursor and the end are
  // the passes' to zero.
  const headers = () => writes.filter((w) => w.buffer.label === 'Trillion3D material cache')
  const header = () => {
    const last = headers().at(-1)!
    return [last.offset / 4, ...new Uint32Array(written(last))]
  }
  assert.deepEqual(header(), [1, rows, capacity])
  const { pass, dispatches } = recorder()
  cache.encode({ pass }, INPUTS)
  // The marks and the triangles' groups cleared, one lane per mark word: eighty groups in rows of
  // two; the marks read in 8 × 8 tiles; five groups of rows in rows of two; the triangles at the
  // size the rows pass wrote, one deep since its creation.
  assert.equal((rows * ROW_MARK_WORDS) / SHADE_ROWS_LANES, 80)
  const depth = writes.find((w) => w.buffer.label === 'Trillion3D material cache dispatch')!
  assert.deepEqual([depth.offset, ...new Uint32Array(written(depth))], [8, 1])
  assert.deepEqual(dispatches, [
    [2, 40, 1],
    [4, 788],
    [2, 3, 1],
    ['Trillion3D material cache dispatch', 0],
  ])
  // A wider image of the same rows: the rows bound the triangles. Then the image bounds them:
  // no more words than its visibility buffer holds texels.
  // An image that lays what the buffer holds writes nothing.
  const sent = headers().length
  cache.layFor(rows, 36, 4000, 4000)
  assert.equal(headers().length, sent, 'the same rows and capacity: no write')
  cache.layFor(rows, 36, 42, 42)
  assert.deepEqual(header(), [2, 42], 'the capacity alone')
  // Fewer rows keep the buffer: only the header says what is laid.
  cache.layFor(3, 36, 26, 6300)
  assert.equal(cache.buffer, laid)
  assert.deepEqual(header(), [1, 3, 36])
})

test('the pass runs the marks, the rows, then the triangles over the row table, from the rows pass dispatch', async () => {
  const { device, bindGroups } = fakeDevice()
  const cache = await createShadeCache(device)
  cache.layFor(10, 36, 64, 64)
  const named = (label: string) => ({ label }) as unknown as GPUBuffer
  const inputs = {
    ...{ pages: named('pages'), indices: named('indices'), positions: named('positions') },
    ...{ uvs: named('uvs'), uniform: named('uniform'), vis: {}, normals: {} },
  } as unknown as ShadeCacheInputs
  const steps: unknown[] = []
  let current: { entryPoint?: string; constants?: Record<string, number> } = {}
  let group: GPUBindGroupDescriptor | undefined
  const bound = (descriptor: GPUBindGroupDescriptor) =>
    (descriptor.entries as GPUBindGroupEntry[]).map(({ binding, resource }) => [
      binding,
      (resource as GPUBufferBinding).buffer?.label ?? 'view',
    ])
  const pass = {
    setPipeline: (pipeline: typeof current) => void (current = pipeline),
    setBindGroup: (_: number, descriptor: GPUBindGroupDescriptor) => void (group = descriptor),
    dispatchWorkgroups: () => void steps.push([current.entryPoint, group]),
    dispatchWorkgroupsIndirect: (buffer: GPUBuffer, offset: number) =>
      void steps.push([current.entryPoint, group, buffer.label, offset]),
  } as unknown as GPUComputePassEncoder
  cache.encode({ pass }, inputs)
  assert.deepEqual(
    (steps as [string][]).map(([entry]) => entry),
    ['shade_clear', 'shade_marks', 'shade_rows', 'shade_tris'],
  )
  const [clear, marks, rows, triangles] = steps as [
    string,
    GPUBindGroupDescriptor,
    string?,
    number?,
  ][]
  assert.equal(marks[1], rows[1], 'the marks and the rows share their group')
  assert.equal(clear[1], rows[1], 'and the clear, which zeroes their marks and the dispatch')
  assert.deepEqual(bound(rows[1]), [
    [0, 'pages'],
    [1, 'Trillion3D material cache'],
    [2, 'view'],
    [3, 'Trillion3D material cache dispatch'],
  ])
  // The triangles read the row table first, then the cache, the geometry and the resolve's uniform.
  assert.deepEqual(bound(triangles[1]), [
    ...[
      [0, 'pages'],
      [1, 'Trillion3D material cache'],
      [2, 'indices'],
      [3, 'positions'],
    ],
    ...[
      [4, 'uvs'],
      [5, 'uniform'],
      [6, 'view'],
    ],
  ])
  assert.deepEqual(triangles.slice(2), ['Trillion3D material cache dispatch', 0])
  assert.equal(bindGroups.length, 2, 'two groups, made once')
  cache.encode({ pass }, inputs)
  assert.equal(bindGroups.length, 2, 'kept while the inputs do not move')
})

test('without a compute stage the pixels compute their own, and no pass is encoded', async () => {
  const { device } = fakeDevice({ compute: false })
  const cache = await createShadeCache(device)
  assert.deepEqual(cache.constants, {})
  cache.layFor(10, 36, 64, 64)
  assert.equal(cache.buffer.size, SHADE_CACHE_HEADER_WORDS * 4, 'the header alone, still bound')
  // No dispatch: the frame's pass is not even asked for.
  cache.encode(
    {
      get pass(): GPUComputePassEncoder {
        throw new Error('no dispatch, no pass')
      },
    },
    INPUTS,
  )
})

test('every class pipeline reads what the cache composes, single or tiled', async () => {
  const { device, renderPipelines } = fakeDevice()
  const cache = await createShadeCache(device)
  const module = {} as GPUShaderModule
  for (const classes of [[3], [3, 5]])
    await createWebgpuShadePipelines(
      device,
      module,
      classes,
      undefined,
      true,
      undefined,
      true,
      cache.constants,
    )
  assert.ok(renderPipelines.length >= 3)
  for (const { fragment } of renderPipelines)
    assert.equal(fragment?.constants?.SHADE_CACHE, 1, 'the pixel reads its frame and triangle')
})
