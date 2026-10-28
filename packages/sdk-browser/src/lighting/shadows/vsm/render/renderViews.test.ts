// The raster's views as the GPU lists them (`renderViewsWgsl.ts`): one view a map and a mip whose stale
// rect is not empty, a map's views one after the other, in the order the maps and their mips come, and
// a group a map that has some. The shipped kernel, run in JavaScript on a frame of a fixed seed,
// against a twin of the compaction written beside it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { fromF32Bits } from '../../../../../../math/src/float/bits.ts'
import { LIGHT_KIND } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'
import { vsmMapViewMips } from '../mapViews.ts'
import { vsmRenderViewsWgsl } from './renderViewsWgsl.ts'

const VIEWS = vsmRenderViewsWgsl(SUNS_LAYOUT)
const C = wgslConstants(VIEWS)
const MIPS = C.VSM_MIPS!

/** A generator of a fixed seed: the same frame on every run. */
function seeded(seed: number) {
  let state = seed >>> 0
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) % below
  }
}

type Kind = 'directional' | 'spot' | 'point'

interface Frame {
  /** The lights' table: first map id, map count, lighting channels. */
  lights: number[][]
  /** Each map's kind, finest mip and the scale of its projection in y (the lens's). */
  maps: { kind: Kind; finestMip: number; scaleY: number }[]
  /** The stale rects, two a (map, mip): the dynamic layer's then the static layer's. */
  rects: number[][]
}

const EMPTY = [1, 1, 0, 0]
const nonEmpty = (rect: number[]) => rect[0]! <= rect[2]! && rect[1]! <= rect[3]!

/** A frame of a fixed seed: a sun of three clipmap levels, a spot, a point light of six faces, a light
 *  whose maps are all cached and a second spot, the stale rects empty at random. */
function frame(seed: number): Frame {
  const roll = seeded(seed)
  const kinds: [Kind, number][] = [
    ['directional', 3],
    ['spot', 1],
    ['point', 6],
    ['point', 6],
    ['spot', 1],
  ]
  const lights: number[][] = [],
    maps: Frame['maps'] = [],
    cached = new Set<number>()
  kinds.forEach(([kind, count], light) => {
    lights.push([maps.length, count, 1 + roll(7)])
    for (let k = 0; k < count; k++) {
      if (light === 3) cached.add(maps.length)
      maps.push({
        kind,
        finestMip: kind === 'directional' ? 0 : roll(3),
        scaleY: 0.25 * (1 + roll(8)),
      })
    }
  })
  const rects: number[][] = []
  maps.forEach((_, id) => {
    for (let slot = 0; slot < MIPS * 2; slot++) {
      const x = roll(4),
        y = roll(4)
      rects[id * MIPS * 2 + slot] =
        cached.has(id) || roll(3) === 0 ? EMPTY : [x, y, x + roll(3), y + roll(3)]
    }
  })
  return { lights, maps, rects }
}

/** The twin of the compaction: the maps of a light in order, each one's mips from its finest, a view
 *  kept where a stale rect is not empty; a group a map with a view, its run's start and length, its id,
 *  the stale layers of its views together and its light's channels. A view is the map, the mip, its stale layers and its level of detail's scale. */
function twin(f: Frame, viewFirst: number, viewCount: number) {
  const views: number[][] = [],
    groups: number[][] = []
  const rectOf = (id: number, mip: number, layer: number) => f.rects[2 * (id * MIPS + mip) + layer]!
  for (const [first, count, channels] of f.lights) {
    if (first! < viewFirst || first! >= viewFirst + viewCount) continue
    for (let id = first!; id < first! + count!; id++) {
      const map = f.maps[id]!
      const start = views.length
      let layersOfMap = 0
      for (let mip = map.finestMip; mip < vsmMapViewMips(map.kind); mip++) {
        const layers =
          (nonEmpty(rectOf(id, mip, 0)) ? 1 : 0) | (nonEmpty(rectOf(id, mip, 1)) ? 2 : 0)
        layersOfMap |= layers
        if (layers) views.push([id, mip, layers, 0.5 * map.scaleY * (C.VSM_LEVEL0_TEXELS! >> mip)])
      }
      if (views.length > start)
        groups.push([
          start,
          views.length - start,
          id,
          layersOfMap | (channels! << C.VSM_RENDER_VIEW_CHANNELS_SHIFT!),
        ])
    }
  }
  return { views, groups }
}

/** The shipped kernel over the frame, a thread a light, the groups and the views read back. */
function listed(f: Frame, viewFirst: number, viewCount: number) {
  const places = f.maps.length * (1 + MIPS)
  const views: number[][] = Array.from({ length: places }, () => [0, 0, 0, 0])
  const counts = new Array(16).fill(0)
  const { vsmRenderViews } = shaderRun<{ vsmRenderViews(...a: unknown[]): void }>(
    VIEWS,
    ['vsmRenderViews'],
    {
      ...C,
      params: { lightCount: f.lights.length, viewFirst, viewCount },
      vsm: { mapCount: f.maps.length },
      lights: f.lights.map((light) => [...light, 0]),
      vsmProjectionData: f.maps.map(({ kind, finestMip, scaleY }) => ({
        lightKind: LIGHT_KIND[kind],
        finestMip,
        lightViewToClip: new Mat([1, 0, 0, 0, 0, scaleY, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      })),
      vsmStaleRects: f.rects,
      views,
      counts,
    },
  )
  for (let rank = 0; rank < f.lights.length; rank++) vsmRenderViews([0, 0, 0], [1, 1, 1], rank)
  const groups = counts[C.VSM_RENDER_COUNT_VIEWS!]!
  return {
    groups: views.slice(0, groups),
    views: views
      .slice(viewCount, viewCount + counts[C.VSM_RENDER_COUNT_RUNS!]!)
      .map(([id, mip, layers, focal]) => [id, mip, layers, fromF32Bits(focal!)]),
  }
}

for (const seed of [1, 7, 20260101]) {
  test(`the views kept are the (map, mip) pairs with a stale rect, in the order the maps and mips come (seed ${seed})`, () => {
    const f = frame(seed)
    for (const [viewFirst, viewCount] of [
      [0, f.maps.length],
      [f.lights[2]![0]!, f.maps.length - f.lights[2]![0]!],
    ] as const) {
      const got = listed(f, viewFirst, viewCount)
      const want = twin(f, viewFirst, viewCount)
      assert.ok(want.views.length > 0, 'the frame lists some views')
      assert.deepEqual(got.views, want.views, `views from ${viewFirst}`)
      assert.deepEqual(got.groups, want.groups, `groups from ${viewFirst}`)
    }
  })
}
