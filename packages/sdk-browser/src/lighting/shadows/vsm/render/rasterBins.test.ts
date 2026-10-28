// The shadow raster's bins (`renderParamsWgsl.ts`, `renderCullWgsl.ts`, `renderPipes.ts`): the
// three families of corner tiers, a two-sided row drawn once with no face culled, the tiers a frame
// draws, and the software raster's two bins by layer.

import { shadowPageLayout } from '../../casters/pageGroup.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import {
  VSM_RENDER_ARGS_BIN,
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_SOFTWARE,
  VSM_RENDER_ARGS_SOFTWARE_STATIC,
  VSM_RENDER_ARGS_WGSL,
  VSM_RENDER_FAMILY,
  vsmRenderTierCorners,
  vsmRenderTierFamily,
  vsmRenderTiersDrawn,
} from './renderParamsWgsl.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'
import { vsmRasterPipe } from './renderPipes.ts'
import { vsmRenderBinWgsl } from './renderBinWgsl.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const LAYOUT = SUNS_LAYOUT
const CULL = vsmRenderCullWgsl(LAYOUT)
const C = wgslConstants(CULL)
const BIN = vsmRenderBinWgsl(LAYOUT)
/** The tiers of a family: the tiers of the raster over its families. */
const VSM_RENDER_CORNER_TIERS = C.VSM_RENDER_TIERS / Object.keys(VSM_RENDER_FAMILY).length

// A row takes the least tier of its family that holds its corners; the WGSL and the host agree on
// each tier's corners.
test('a row takes a tier of its family, a two-sided row drawn once at its index count', () => {
  const { vsmRenderTierOf, vsmRenderTierCorners: corners } = shaderRun<{
    vsmRenderTierOf(corners: number): number
    vsmRenderTierCorners(tier: number): number
  }>(CULL, ['vsmRenderTierOf', 'vsmRenderTierCorners'], C)
  const tiersOf = (bit: number) => [3, 96, 97, 384, 768].map((n) => vsmRenderTierOf(n | bit))
  const levels = [0, 0, 1, 2, 3]
  const inFamily = (family: number) =>
    levels.map((level) => family * VSM_RENDER_CORNER_TIERS + level)
  assert.deepEqual(tiersOf(0), inFamily(VSM_RENDER_FAMILY.oneSided), 'one-sided')
  assert.deepEqual(
    tiersOf(C.VSM_RENDER_DOUBLE_BIT),
    inFamily(VSM_RENDER_FAMILY.twoSided),
    'two-sided: the same corners',
  )
  assert.deepEqual(tiersOf(C.VSM_RENDER_VOXEL_BIT), inFamily(VSM_RENDER_FAMILY.voxel), 'voxel')
  assert.equal(
    vsmRenderTierFamily(vsmRenderTierOf(3 | C.VSM_RENDER_DOUBLE_BIT | C.VSM_RENDER_VOXEL_BIT)),
    VSM_RENDER_FAMILY.voxel,
    'a voxel row wins',
  )
  for (let tier = 0; tier < C.VSM_RENDER_TIERS; tier++)
    assert.equal(corners(tier), vsmRenderTierCorners(tier), `tier ${tier}`)
  assert.equal(vsmRenderTierCorners(VSM_RENDER_CORNER_TIERS), 96, 'each family restarts at 96')
})

// The one-sided family is always drawn, the two-sided and the voxel ones where the table holds a row
// of each.
test('a frame draws the tiers of the families its table holds a row of', () => {
  const family = (f: number) =>
    Array.from({ length: VSM_RENDER_CORNER_TIERS }, (_, t) => f * VSM_RENDER_CORNER_TIERS + t)
  const { oneSided, twoSided, voxel } = VSM_RENDER_FAMILY
  assert.deepEqual(vsmRenderTiersDrawn({ twoSided: false, voxels: false }), family(oneSided))
  assert.deepEqual(vsmRenderTiersDrawn({ twoSided: true, voxels: false }), [
    ...family(oneSided),
    ...family(twoSided),
  ])
  assert.deepEqual(vsmRenderTiersDrawn({ twoSided: false, voxels: true }), [
    ...family(oneSided),
    ...family(voxel),
  ])
  assert.equal(vsmRenderTiersDrawn({ twoSided: true, voxels: true }).length, C.VSM_RENDER_TIERS)
})

// The one-sided rows' pipelines cull the back faces, the two-sided rows' none: the reversed-depth
// and swap rules stay with the one-sided family (a vertex swaps by the record's bit alone), and a
// two-sided row's triangle is covered whichever way it faces. Every tier is compiled once asked;
// the frame asks the two-sided ones with the one-sided ones (`prepareVsmPipelines`).
test('the two-sided tiers’ pipelines cull no face', async () => {
  const limits = { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 }
  const fake = fakeDevice({ limits })
  const { device, renderPipelines } = fake
  const pipes = vsmRasterPipe(device, LAYOUT, shadowPageLayout(device))
  const made = (tier: number) =>
    renderPipelines.find(({ label }) => label === `vsm.render.raster${tier}`)
  const prepare = (tiers: readonly number[]) =>
    Promise.all(tiers.map((tier) => pipes.tiers[tier].prepare()))
  const firstOf = (family: number) => family * VSM_RENDER_CORNER_TIERS
  const withTwoSided = vsmRenderTiersDrawn({ twoSided: true, voxels: false })
  await prepare(vsmRenderTiersDrawn({ twoSided: false, voxels: false }))
  assert.equal(made(firstOf(VSM_RENDER_FAMILY.twoSided)), undefined, 'none before they are asked')
  await prepare(withTwoSided)
  for (const tier of withTwoSided) {
    const pipe = made(tier)!
    assert.equal(
      pipe.primitive?.cullMode,
      vsmRenderTierFamily(tier) === VSM_RENDER_FAMILY.oneSided ? 'back' : 'none',
      `tier ${tier}`,
    )
    assert.equal(
      (pipe.vertex.constants as Record<string, number>).VSM_RENDER_CORNERS,
      vsmRenderTierCorners(tier),
      `tier ${tier}: its corners`,
    )
  }
  assert.equal(
    made(firstOf(VSM_RENDER_FAMILY.voxel)),
    undefined,
    'the voxel tiers wait for a voxel row',
  )
})

// The argument kernel gives the software raster a grid a layer, the static layer's records after the
// dynamic's in the sorted list, the hardware tiers after both.
test('the bin’s arguments size one software grid a layer and place the cursors', () => {
  const K = wgslConstants(VSM_RENDER_ARGS_WGSL)
  const run = (dynamicCount: number, staticCount: number, tier0: number, viewCount = 0) => {
    const counts = new Array(64).fill(0),
      args = new Array(128).fill(-1)
    counts[K.VSM_RENDER_COUNT_RECORDS] = dynamicCount + staticCount + tier0
    counts[K.VSM_RENDER_TIER_RECORDS + K.VSM_RENDER_SOFTWARE_BIN] = dynamicCount
    counts[K.VSM_RENDER_TIER_RECORDS + K.VSM_RENDER_SOFTWARE_STATIC_BIN] = staticCount
    counts[K.VSM_RENDER_TIER_RECORDS] = tier0
    shaderRun<{ vsmRenderArgsBin(): void }>(VSM_RENDER_ARGS_WGSL, ['vsmRenderArgsBin'], {
      ...K,
      counts,
      args,
      vsmStats: [],
      params: { recordCapacity: 100, viewCount },
    }).vsmRenderArgsBin()
    const cursor = (bin: number) => counts[K.VSM_RENDER_TIER_CURSOR + bin]
    return { args, cursor }
  }
  const { args, cursor } = run(5, 3, 7)
  assert.equal(args[VSM_RENDER_ARGS_SOFTWARE], 5, 'a group a dynamic record')
  assert.equal(args[VSM_RENDER_ARGS_SOFTWARE_STATIC], 3, 'a group a static record')
  assert.deepEqual(
    [cursor(K.VSM_RENDER_SOFTWARE_BIN), cursor(K.VSM_RENDER_SOFTWARE_STATIC_BIN)],
    [0, 5],
    'the static layer’s records follow the dynamic’s',
  )
  assert.equal(cursor(0), 8, 'the first tier after both')
  assert.equal(args[VSM_RENDER_ARGS_DRAW], 7 * vsmRenderTierCorners(0), 'its corners')
  assert.equal(args[VSM_RENDER_ARGS_DRAW + 2], 8 * vsmRenderTierCorners(0), 'from its first record')
  // A thread a record, whatever the maps of the pass (the views are laid by their own kernel).
  assert.equal(args[VSM_RENDER_ARGS_BIN], 1, 'fifteen records: one group')
  assert.equal(run(5, 3, 7, 200).args[VSM_RENDER_ARGS_BIN], 1, 'two hundred maps: still one group')
})

// The bin marks the pages the cull matched and no other (the reference's cull marks the pages it
// keeps by the flag mask): the mask is the layer's stale mark, or the wanted mark of a cache state that
// turned, as the cull put it in the record.
test('the bin matches the pages by the marks the cull put in the record', () => {
  const K = wgslConstants(BIN)
  const run = shaderRun<{
    vsmRecordMarkMask(r: number[]): number
    vsmRecordMarksMatch(marks: number, mask: number): boolean
  }>(BIN, ['vsmRecordMarkMask', 'vsmRecordMarksMatch'], K)
  const record = (y: number) => [0, y >>> 0, 0, 0]
  assert.equal(run.vsmRecordMarkMask(record(0)), K.VSM_PAGE_DYNAMIC_STALE, 'the dynamic layer')
  assert.equal(run.vsmRecordMarkMask(record(1 << 21)), K.VSM_PAGE_STATIC_STALE, 'the static layer')
  assert.equal(run.vsmRecordMarkMask(record((1 << 21) | (1 << 19))), K.VSM_PAGE_WANTED, 'turned')
  // A page of the other layer, stale there alone, is not marked drawn by a record of this one.
  assert.equal(run.vsmRecordMarksMatch(K.VSM_PAGE_DYNAMIC_STALE!, K.VSM_PAGE_DYNAMIC_STALE!), true)
  assert.equal(run.vsmRecordMarksMatch(K.VSM_PAGE_STATIC_STALE!, K.VSM_PAGE_DYNAMIC_STALE!), false)
  assert.equal(run.vsmRecordMarksMatch(K.VSM_PAGE_STATIC_STALE!, K.VSM_PAGE_STATIC_STALE!), true)
})

// The view of each map of a pass is laid after the sorted list's records and their counts, a pass's
// first map first, for the software raster to place its corners by: the columns of the shifted-to-map
// matrix, then the origin shift's high part with the offsets' threshold, then its low part.
test('the views of the maps are laid after the records and their counts, a map a thread', () => {
  const K = wgslConstants(BIN)
  const capacity = 10,
    first = 2
  const matrix = Array.from({ length: 16 }, (_, i) => i + 1)
  const maps = Array.from({ length: 5 }, () => ({
    ...{ shiftedToMapUv: new Mat(matrix), wpoThreshold: 0.25 },
    ...{ originShiftHigh: [0.5, 1.5, 2.5], originShiftLow: [-1, -2, -3] },
  }))
  const sorted = Array.from(
    { length: capacity + 1 + 3 * K.VSM_RENDER_SOFTWARE_VIEW_RECORDS! },
    () => [0, 0, 0, 0],
  )
  shaderRun<{ vsmLayView(map: number): void }>(BIN, ['vsmLayView'], {
    ...K,
    sorted,
    vsmProjectionData: maps,
    params: { recordCapacity: capacity, viewFirst: first },
  }).vsmLayView(4)
  const bits = (values: number[]) => [...new Uint32Array(new Float32Array(values).buffer)]
  const at = capacity + 1 + 2 * K.VSM_RENDER_SOFTWARE_VIEW_RECORDS!
  assert.deepEqual(
    sorted.slice(at, at + K.VSM_RENDER_SOFTWARE_VIEW_RECORDS!),
    [
      ...[0, 1, 2, 3].map((column) => bits(matrix.slice(4 * column, 4 * column + 4))),
      bits([0.5, 1.5, 2.5, 0.25]),
      bits([-1, -2, -3, 0]),
    ],
    'the third map of the pass: its columns, its origin shift and threshold',
  )
  assert.deepEqual(sorted[capacity], [0, 0, 0, 0], 'the counts’ word is not touched')
})

// A record is placed among its bin's by a counter add a subgroup (or a workgroup) and bin, not one a
// record: the kernel itself takes no place of the counters, in either text.
test('the bin takes its places a subgroup at a time, or a workgroup at a time without subgroups', () => {
  for (const [code, uses, avoids] of [
    [vsmRenderBinWgsl(LAYOUT, true), /subgroupExclusiveAdd\(/, /workgroupBarrier\(/],
    [vsmRenderBinWgsl(LAYOUT, false), /workgroupBarrier\(/, /subgroup[A-Z]\w*\(/],
  ] as const) {
    assert.doesNotMatch(functionsOf(code, ['vsmRenderBin']), /atomicAdd\(/)
    const place = functionsOf(code, ['vsmBinPlace'])
    assert.match(place, uses)
    assert.doesNotMatch(place, avoids)
    // Every lane of the group calls it, before any lane leaves.
    const kernel = functionsOf(code, ['vsmRenderBin'])
    assert.ok(kernel.indexOf('vsmBinPlace(') < kernel.indexOf('return;'))
  }
})
