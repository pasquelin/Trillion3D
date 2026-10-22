// The shadow raster's chunk pass draws one indirect command a corner tier whose arguments the GPU
// wrote — the voxel tier too on a frame whose table holds a voxel row, none here —, in a pass of
// its own between the chunk's compute passes: its commands are encoded directly, never as a render
// bundle — a bundle there would cost a key and `executeBundles` for the same commands. The lights
// are grouped whole into view passes of the maps a dispatch of the cull lists (`vsmViewPasses`),
// each its own views over the same chunks of rows: the same pages, one pass or several.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from '../resources.ts'
import { encodeVsmRender } from '../render/renderPass.ts'
import {
  encodeLights,
  LOW_DISPATCH,
  manyLights,
  paramWords,
  recordingRaster,
} from '../recordingRaster.fixture.ts'
import {
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_CORNER_TIERS,
  VSM_RENDER_COUNT_VIEWS,
} from '../render/renderParamsWgsl.ts'
import {
  VSM_MAP_ID_BITS,
  VSM_MAX_VIEW_PASSES,
  vsmViewPasses,
  vsmViewsPerPass,
} from '../render/renderViewPasses.ts'
import { vsmRenderViewsWgsl } from '../render/renderViewsWgsl.ts'
import { vsmRenderCullWgsl } from '../render/renderCullWgsl.ts'
import { vsmRenderRasterWgsl } from '../render/renderRasterWgsl.ts'
import { vsmRenderFloorBytes } from '../render/renderBudget.ts'
import { vsmLayout } from '../layout.ts'
import { planFrames, randomWorld } from '../planFrames.fixture.ts'
import { mulberry32 } from '../../../../../../math/src/sequence/random.ts'
import { WORKGROUP_THREADS } from '../../../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

test('each chunk raster encodes two groups and a pipeline and indirect draw a tier, no bundle', () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const { encoder, scene, lights } = recordingRaster(device, 100)
  const { chunks } = encodeVsmRender(encoder, res, { device, lights }, scene)!
  assert.ok(chunks > 0)
  const chunkRasters = fake.passes.filter(({ label }) => /\.raster \d+$/.test(label ?? ''))
  assert.equal(chunkRasters.length, chunks, 'one raster pass a chunk')
  chunkRasters.forEach(({ commands }, c) => {
    const tiers = Array.from({ length: VSM_RENDER_CORNER_TIERS }, (_, t) => t)
    assert.deepEqual(
      commands.map(([name]) => name),
      [
        'setBindGroup',
        'setBindGroup',
        ...tiers.flatMap(() => ['setPipeline', 'drawIndirect']),
        'end',
      ],
    )
    assert.equal(commands[0][1][1], scene.pageGroup, 'the page group at 0')
    for (const t of tiers)
      assert.equal(
        commands[3 + 2 * t][1][1],
        (c * VSM_RENDER_ARGS_STRIDE_WORDS + VSM_RENDER_ARGS_DRAW + 4 * t) * 4,
        "the chunk's own arguments of the tier",
      )
  })
  assert.equal(fake.bundles.length, 0, 'no bundle recorded')
})

test('a cut that follows no world still gives the candidates its frame words, where the draw distances lie', () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const { encoder, scene, lights } = recordingRaster(device, 100)
  const frames = {} as GPUTextureView
  encodeVsmRender(encoder, res, { device, lights }, { ...scene, world: { frames } })
  const bound = fake.bindGroups.filter(({ entries }) =>
    [...entries].some(({ resource }) => resource === frames),
  )
  assert.ok(bound.length > 0, 'the frame words are bound')
  for (const { entries } of bound)
    assert.notEqual([...entries][0].resource, frames, 'beside a stand-in for the cold words')
})

test('the lights are grouped whole, in order, into passes of the maps a dispatch lists', () => {
  // On 500 rows: the sun's 17 maps and 80 point lights, then 83, then the last 37.
  const { list, maps, mostMaps, mostMips } = vsmViewPasses(manyLights(200), 500)
  assert.deepEqual(
    list.map(({ first, maps: held, mips }) => [first, held, mips]),
    [
      [0, 17 + 80 * 6, 17 + 80 * 48],
      [17 + 80 * 6, 83 * 6, 83 * 48],
      [17 + 163 * 6, 37 * 6, 37 * 48],
    ],
  )
  assert.deepEqual([maps, mostMaps, mostMips], [17 + 200 * 6, 83 * 6, 83 * 48])
  // A light is never split: one past the limit alone has a pass of its own.
  assert.deepEqual(
    vsmViewPasses(manyLights(2), 6).list.map(({ first, maps: held }) => [first, held]),
    [
      [0, 17],
      [17, 6],
      [23, 6],
    ],
  )
  // Lights without ids (the floor's, before the maps are set up) fall in the same passes.
  const bare = manyLights(200).map(({ kind, count }) => ({ kind, count }))
  assert.deepEqual(vsmViewPasses(bare, 500).list, list)
  // None, no pass; off, every light in one pass, however many maps it holds.
  assert.equal(vsmViewPasses([], 500).list.length, 0)
  const off = vsmViewPasses(manyLights(200), vsmViewsPerPass({}, false))
  assert.deepEqual([off.list.length, off.maps], [1, 17 + 200 * 6])
})

test('a pass lists the maps of a dispatch’s rows, no more than a map id holds: one pass for any frame on any device', () => {
  const rows = 65535 // what every device guarantees (`maxComputeWorkgroupsPerDimension`)
  assert.equal(vsmViewsPerPass({}, true), rows)
  assert.equal(vsmViewsPerPass(LOW_DISPATCH, true), 500)
  assert.equal(vsmViewsPerPass({ maxComputeWorkgroupsPerDimension: 2 ** 31 - 1 }, true), 2 ** 16)
  // The id the commands and the pairs pack: `VSM_MAP_ID_BITS` wide, below the mip, read back by the
  // expand, the raster and the transmission with a mask of that width.
  const layout = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
  const mask = `0x${((1 << VSM_MAP_ID_BITS) - 1).toString(16).toUpperCase()}u`
  assert.ok(vsmRenderCullWgsl(layout).includes(`view.x|(mipLevel<<${VSM_MAP_ID_BITS}u)`))
  assert.ok(vsmRenderRasterWgsl(layout).includes(`vsmProjectionData[pair.y&${mask}]`))
  // The most passes any frame takes, which the timed passes are sized for.
  const ids = [
    { kind: 'point', firstId: 0, count: 1 << VSM_MAP_ID_BITS },
    { kind: 'point', firstId: 1 << VSM_MAP_ID_BITS, count: 1 },
  ]
  assert.equal(vsmViewPasses(ids, rows).list.length, VSM_MAX_VIEW_PASSES)
  // A frame's maps are the layout's at most: a page table of the tallest texture a device makes
  // (32 768 texels: 171 rows of 8 blocks) and 8192, far under a pass — so the transmission's bin,
  // which lists them all in one pass, is never split either.
  assert.ok(vsmLayout({ fullMapCapacity: 8 * ceilDiv(32768, 192) }).mapSlots < rows)
  // Every frame of the default device is one pass, the switch on or off: the same encode.
  const lights = manyLights(200)
  const [on, off] = [true, false].map((multipassViews) => encodeLights(lights, { multipassViews }))
  assert.deepEqual([on.passes, off.passes], [1, 1])
  assert.deepEqual(on.fake.commands, off.fake.commands)
  assert.equal(on.fake.dispatches.length, off.fake.dispatches.length)
  assert.deepEqual(paramWords(on.fake).words, paramWords(off.fake).words, 'the same bytes')
})

test('the lights’ maps lie in consecutive ids, from 0, as the passes read them', () => {
  const frames = planFrames()
  const random = mulberry32(3)
  for (let k = 0; k < 4; k++) {
    const { plan } = frames.frame(randomWorld(random, [0, 0, 0]))
    assert.ok(plan.lights.length > 1)
    let next = 0
    for (const { firstId, count } of plan.lights) {
      assert.equal(firstId, next, 'no gap, no reorder')
      next = firstId + count
    }
    const [whole] = vsmViewPasses(plan.lights, 65535).list // the default: one pass holds them all
    assert.deepEqual([whole.first, whole.maps], [0, next])
  }
})

test('the floor sets aside a slot a chunk of each pass', () => {
  const limits = { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 } as never
  const floor = (passes: number) => vsmRenderFloorBytes(limits, 20_000, 4 * 497, 3984, 256, passes)
  assert.ok(floor(2) > floor(1) && floor(3) > floor(2), 'the slots of each pass, not of one')
})

test('a frame of many lights draws in view passes: each clears the views’ count, lists its views, then draws the same chunks', () => {
  // 200 point lights and a sun on a device whose dispatches have 500 rows: 1217 maps, three passes
  // of 497, 498 and 222 maps. Before, one pass: a clear, the candidates, the views and the
  // arguments once, then 2 · chunks passes.
  const { fake, stats, passes, slots } = encodeLights(manyLights(200), {}, LOW_DISPATCH)
  const { chunks } = stats
  assert.equal(passes, 3)
  const sequence = fake.commands.filter((c) => /^(clear|.*(cull|raster) \d+)$/.test(c))
  const chunkPasses = (first: number) =>
    Array.from({ length: chunks }, (_, c) => [
      `compute vsm.render.cull ${first + c}`,
      `render vsm.render.raster ${first + c}`,
    ]).flat()
  assert.deepEqual(
    sequence,
    [0, 1, 2].flatMap((p) => ['clear', ...chunkPasses(p * chunks)]),
  )
  const counts = fake.buffers.find((b) => b.label === 'vsm.render.counts') as unknown as GPUBuffer
  const clears = fake.clears.filter((c) => c.buffer === counts).slice(1)
  assert.deepEqual(
    clears.map(({ offset, size }) => [offset, size]),
    Array(2).fill([4 * VSM_RENDER_COUNT_VIEWS, 4]),
    'after the counters whole, the views’ count alone',
  )
  const entries = (name: string) => fake.dispatches.filter(({ entryPoint }) => entryPoint === name)
  assert.equal(entries('vsmRenderCandidates').length, 1, 'the candidates, once')
  for (const name of ['vsmRenderViews', 'vsmRenderArgsCull'])
    assert.deepEqual(
      entries(name).map(({ pass }) => pass),
      [0, 2 * chunks, 4 * chunks],
      `${name}: opening each pass`,
    )
  assert.deepEqual(
    entries('vsmRenderViews').map(({ direct }) => direct),
    [497, 498, 222].map((maps) => ceilDiv(maps, WORKGROUP_THREADS)),
  )
  // A pass's slots: its chunks' own indices, its maps, the rows of its chunk.
  const maps = [
    [0, 497],
    [497, 498],
    [995, 222],
  ]
  assert.equal(slots.length, passes * chunks)
  slots.forEach(({ chunk, chunkFirst, viewFirst, viewCount }, g) => {
    const [first, held] = maps[Math.floor(g / chunks)]
    assert.deepEqual(
      [chunk, chunkFirst, viewFirst, viewCount],
      [g, (g % chunks) * stats.chunkRows, first, held],
    )
  })
})

/** The ids the shipped views kernel lists, run over each of `slots` — a view pass's maps — on maps
 *  of `total` ids where `drawn` ones have a stale rect on a mip the raster takes of them: a sun's
 *  level its one (0), a local map one of its mips (3, past its finest, 2). */
function listedViews(
  slots: { viewFirst: number; viewCount: number }[],
  total: number,
  drawn: (id: number) => boolean,
) {
  const code = vsmRenderViewsWgsl(vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 }))
  const constants = wgslConstants(code)
  const rects = new Proxy([] as number[][], {
    get: (_, key) => {
      const k = Number(key),
        id = Math.floor(k / 2 / constants.VSM_MIPS)
      const mip = Math.floor(k / 2) % constants.VSM_MIPS
      return drawn(id) && mip === (id < 17 ? 0 : 3) && k % 2 === 0 ? [0, 0, 1, 1] : [1, 1, 0, 0]
    },
  })
  const kind = (id: number) => constants.LIGHT_KIND_DIRECTIONAL + (id < 17 ? 0 : 1)
  const vsmProjectionData = Array.from({ length: total }, (_, id) => ({
    lightKind: kind(id),
    finestMip: id < 17 ? 0 : 2,
  }))
  const found: number[] = []
  for (const params of slots) {
    const views: number[][] = [],
      counts = [0, 0, 0, 0]
    const scope = {
      ...constants,
      params,
      vsm: { mapCount: total },
      vsmProjectionData,
      vsmStaleRects: rects,
      views,
      counts,
    }
    const { vsmRenderViews } = shaderRun<{
      vsmRenderViews: (w: number[], n: number[], lane: number) => void
    }>(code, ['vsmRenderViews'], scope)
    const groups = ceilDiv(params.viewCount, WORKGROUP_THREADS)
    for (let g = 0; g < groups; g++)
      for (let lane = 0; lane < WORKGROUP_THREADS; lane++)
        vsmRenderViews([g, 0, 0], [groups, 1, 1], lane)
    assert.equal(counts[VSM_RENDER_COUNT_VIEWS], views.length, 'its count')
    for (const [id] of views)
      assert.ok(
        id >= params.viewFirst && id < params.viewFirst + params.viewCount,
        'within its maps',
      )
    found.push(...views.map(([id]) => id))
  }
  return found.sort((a, b) => a - b)
}

test('the same pages are drawn with one view pass or several: the same maps are listed, each once, in the pass of its light', () => {
  const lights = manyLights(200),
    total = 17 + 200 * 6
  const several = encodeLights(lights, {}, LOW_DISPATCH),
    one = encodeLights(lights, { multipassViews: false }, LOW_DISPATCH)
  assert.deepEqual([several.passes, one.passes], [3, 1])
  assert.equal(one.stats.chunks, several.stats.chunks, 'the same chunks of rows')
  // A pass's first slot says its maps; the views kernel lists those with a page to draw.
  const first = (run: typeof several) => run.slots.filter((_, k) => k % run.stats.chunks === 0)
  const expected = Array.from({ length: total }, (_, id) => id).filter((id) => id % 3 !== 0)
  assert.deepEqual(
    listedViews(first(several), total, (id) => id % 3 !== 0),
    expected,
  )
  assert.deepEqual(
    listedViews(first(one), total, (id) => id % 3 !== 0),
    expected,
  )
})
