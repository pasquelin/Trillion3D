// The occlusion pyramid of the shadow pool (`occlusionWgsl.ts`): its build, page by page, and
// its rebuild of the pages drawn since. Split from `../rasterSkips.test.ts` by subject, as the bound
// on a test file's lines asks.

import { mulberry32 } from '../../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

import { vsmRenderCullWgsl } from '../render/renderCullWgsl.ts'

import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'

import { vsmLayout } from '../layout.ts'

import { f32Bits } from '../../../../../../math/src/float/bits.ts'
import {
  vsmBuildPyramidTopWgsl,
  vsmBuildPyramidWgsl,
  vsmSelectPyramidWgsl,
} from '../occlusion/occlusionWgsl.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
const CULL = vsmRenderCullWgsl(LAYOUT)

// The occlusion pyramid of a page, built as shipped (`occlusion/occlusionWgsl.ts`): its 16 tile groups, each thread's 2x2 pool
// texels, then the halvings in workgroup memory — run thread by thread between the barriers —, then
// the top group from level 3. Every texel of every level is the least depth (reversed Z: the
// farthest) of the pool texels under it, read in the static slice, or in slice 0 for a page whose
// map is redrawn whole.
test('the occlusion pyramid of a page holds the farthest depth under each texel, every level', () => {
  const C = wgslConstants(CULL)
  const page = 130,
    pageXY = [page & 127, page >> 7]
  const rand = mulberry32(11)
  const depth = new Map<string, number>()
  const poolDepth = (x: number, y: number, slice: number) => {
    const key = `${x},${y},${slice}`
    if (!depth.has(key)) depth.set(key, Math.fround(rand()))
    return depth.get(key)!
  }
  const levels = new Map<string, number>()
  const store = (level: number) => ({
    store: (at: number[], layer: number, value: number[]) => {
      assert.equal(layer, 0, 'one layer')
      levels.set(`${level}:${at[0]},${at[1]}`, value[0])
    },
  })
  for (const viewUncached of [false, true]) {
    levels.clear()
    const shared = new Array(256).fill(0)
    const scope = {
      vsm: { poolPages: 256, poolRowShift: 7, poolRowMask: 127, staticSlice: 1, hzbStaticLayer: 0 },
      vsmPoolPageInfo: Array.from({ length: 256 }, () => ({
        flags: viewUncached ? C.VSM_META_VIEW_UNCACHED : 0,
      })),
      pyramidPages: [page],
      pyramidShared: shared,
      vsmPoolLoad: (t: number[], slice: number) => f32Bits(poolDepth(t[0], t[1], slice)),
      ...Object.fromEntries([0, 1, 2, 3].map((l) => [`pyramidLevel${l}`, store(l)])),
    }
    const tile = shaderRun<{
      vsmPyramidTileOf(group: number, lane: number): object
      vsmPyramidGather(texel: number[], slice: number): number[]
      vsmPyramidFirst(t: object, lane: number, layer: number, z: number[]): void
      vsmPyramidHalve(level: number, t: object, lane: number, layer: number): void
    }>(
      vsmBuildPyramidWgsl(LAYOUT),
      ['vsmPyramidTileOf', 'vsmPyramidGather', 'vsmPyramidFirst', 'vsmPyramidHalve'],
      scope,
    )
    for (let group = 0; group < 16; group++) {
      const tiles = Array.from({ length: 256 }, (_, lane) => tile.vsmPyramidTileOf(group, lane))
      tiles.forEach((t, lane) => {
        const { texel, slice } = t as { texel: number[]; slice: number }
        tile.vsmPyramidFirst(t, lane, 0, tile.vsmPyramidGather(texel, slice))
      })
      for (let level = 1; level < 4; level++)
        tiles.forEach((t, lane) => tile.vsmPyramidHalve(level, t, lane, 0))
    }
    const top4 = new Array(16).fill(0),
      top5 = new Array(4).fill(0)
    const top = shaderRun<{
      vsmPyramidTopFirst(page: number[], local: number[], layer: number): void
      vsmPyramidTopSecond(page: number[], local: number[], layer: number): void
      vsmPyramidTopLast(page: number[], local: number[], layer: number): void
    }>(
      vsmBuildPyramidTopWgsl(LAYOUT),
      ['vsmPyramidTopFirst', 'vsmPyramidTopSecond', 'vsmPyramidTopLast'],
      {
        pyramidTop4: top4,
        pyramidTop5: top5,
        pyramidLevel3: { load: (at: number[]) => [levels.get(`3:${at[0]},${at[1]}`)!] },
        ...Object.fromEntries([4, 5, 6].map((l) => [`pyramidLevel${l}`, store(l)])),
      },
    )
    const locals = Array.from({ length: 16 }, (_, k) => [k & 3, k >> 2])
    for (const step of ['vsmPyramidTopFirst', 'vsmPyramidTopSecond', 'vsmPyramidTopLast'] as const)
      for (const local of locals) top[step](pageXY, local, 0)
    const slice = viewUncached ? 0 : 1
    for (let level = 0; level < 7; level++) {
      const side = 64 >> level,
        span = 2 << level
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          let least = Infinity
          for (let j = 0; j < span; j++)
            for (let i = 0; i < span; i++)
              least = Math.min(
                least,
                poolDepth(pageXY[0] * 128 + x * span + i, pageXY[1] * 128 + y * span + j, slice),
              )
          const at = `${level}:${pageXY[0] * side + x},${pageXY[1] * side + y}`
          assert.equal(levels.get(at), least, `level ${level} texel ${x},${y}`)
        }
    }
    assert.equal(
      levels.size,
      64 * 64 + 32 * 32 + 16 * 16 + 8 * 8 + 4 * 4 + 2 * 2 + 1,
      'no other texel',
    )
  }
})

// The page selection of the pyramid's build:
// each page's raster marks folded into its words and cleared, then a held page whose static layer
// was drawn — or its dynamic layer where its map is redrawn whole — listed, one group of the top
// build each; every held page with the full update.
test('the pyramid rebuilds the pages drawn since its last build, each its 16 tiles and its top', () => {
  const C = wgslConstants(CULL)
  const W = C.VSM_PAGE_WANTED,
    pages = 6
  const run = (fullUpdate: number, hzbStaticLayer = 0) => {
    const marks = new Array(4 * pages).fill(0)
    // Page 1 static drawn; 2 dynamic drawn in a cached map; 3 dynamic drawn, its map redrawn whole;
    // 4 static drawn but unseen; 5 no map's; 0 held, not drawn.
    marks[pages + 1] = 1
    marks[2] = 1
    marks[3] = 1
    marks[pages + 4] = 1
    marks[pages + 5] = 1
    const info = [W, W, W, W | C.VSM_META_VIEW_UNCACHED, W | C.VSM_META_UNSEEN, 0].map((flags) => ({
      flags,
    }))
    const args = [16, 0, 1, 0, 0, 1, 1, 0],
      listed: number[] = []
    const kernel = shaderRun<{ vsmSelectPyramidPages(id: number[]): void }>(
      vsmSelectPyramidWgsl(LAYOUT),
      ['vsmSelectPyramidPages'],
      {
        vsm: { poolPages: pages, hzbStaticLayer },
        vsmRasterMarks: marks,
        vsmPoolPageInfo: info,
        pyramidArgs: args,
        pyramidPages: listed,
        pyramidParams: { fullUpdate },
      },
    )
    for (let p = 0; p < pages; p++) kernel.vsmSelectPyramidPages([p, 0, 0])
    assert.ok(
      marks.every((m) => m === 0),
      'the marks cleared',
    )
    assert.equal(info[1].flags & C.VSM_META_STATIC_DRAWN, C.VSM_META_STATIC_DRAWN, 'folded')
    return { listed, args }
  }
  assert.deepEqual(run(0), { listed: [1, 3], args: [16, 2, 1, 0, 2, 1, 1, 0] })
  assert.deepEqual(run(1).listed, [0, 1, 2, 3, 4], 'every held page')
  // With a layer for the dynamic casters, a cached map's page drawn dynamically is listed too.
  assert.deepEqual(run(0, 1).listed, [1, 2, 3])
})
