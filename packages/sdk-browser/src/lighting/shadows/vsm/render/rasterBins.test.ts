// The shadow raster's bins (`renderParamsWgsl.ts`, `renderCullWgsl.ts`, `renderPipes.ts`): the
// three families of corner tiers, a two-sided row drawn once with no face culled, the tiers a frame
// draws, and the software raster's two bins by layer.

import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { vsmLayout } from '../layout.ts'
import {
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_SOFTWARE,
  VSM_RENDER_ARGS_SOFTWARE_STATIC,
  VSM_RENDER_ARGS_WGSL,
  VSM_RENDER_CORNER_TIERS,
  VSM_RENDER_FAMILY,
  vsmRenderTierCorners,
  vsmRenderTierFamily,
  vsmRenderTiersDrawn,
} from './renderParamsWgsl.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'
import { vsmRasterPipe } from './renderPipes.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
const CULL = vsmRenderCullWgsl(LAYOUT)
const C = wgslConstants(CULL)

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
  const pipes = vsmRasterPipe(device, LAYOUT, device.createBindGroupLayout({ entries: [] }))
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
  const run = (dynamicCount: number, staticCount: number, tier0: number) => {
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
      params: { recordCapacity: 100 },
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
})
