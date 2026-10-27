// The prefiltered distant shadow's history blend (`filterableWgsl.ts`), run as the shipped text: the
// previous frame's value found at the texel's place, the difference moved by (1 - blend) and never
// less than a 255th, none where the previous page was no secondary request or its cover lacks the texel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../../../../../math/src/sequence/random.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import {
  Mat,
  type Mat3,
  matrixProduct,
} from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { VSM_PAGE_TEXELS } from './constants.ts'
import { filterableWorld, orthoMap } from './filterableWorld.fixture.ts'
import {
  VSM_FILTERABLE_PAGE_SIZE,
  VSM_MAP_LEVEL_INDEX_SHIFT,
  VSM_MAP_PREFILTERED_DISTANT,
} from './prefilteredConstants.ts'

const SIDE = VSM_PAGE_TEXELS
const BLEND = 0.87
/** Texel (10, 10) of the page (64, 64) of the clipmap at its centre: 14.8 m out, level 10 of the map. */
const TEXEL = 10

/** The byte the blend gives, by the rule: the difference moves by (1 - blend), at least a 255th. */
function after(current: number, previous: number) {
  let delta = ((current - previous) / 255) * (1 - BLEND)
  if (Math.abs(delta) < 1 / 255) delta = Math.sign(delta) / 255
  return Math.round(Math.min(Math.max(previous / 255 + delta, 0), 1) * 255)
}

interface Options {
  /** The filtered value this frame, the previous frame's at the place, as bytes. */
  current: number
  previous: number | 'ramp'
  /** The previous frame's page is a secondary request. */
  secondary?: boolean
  /** The previous map's cover: absent for none, else the bits of the half page the texel is in. */
  cover?: number
  blend?: number
  /** The previous frame's id of the clipmap whose id is now 0; absent, none. */
  previousId?: number
  /** The previous map's transform, and its origin shift with the clipmap's origin, moved from this frame's. */
  to?: Mat
  shift?: number[]
  /** The level of the clipmap the page is in. */
  level?: number
}

/** Page 0 of map 0 at (64, 64), its temp bytes all `current`; the previous frame's map 0 the same, its
 *  page (64, 64) the pool page 5 whose separate bytes are `previous`; the output byte of the texel. */
function blended(o: Options) {
  const w = filterableWorld()
  const flags = VSM_MAP_PREFILTERED_DISTANT
  w.addMap(0, { flags, mapLevel: 10, levelsLeft: 2 })
  w.addMap(1, { flags: flags | (1 << VSM_MAP_LEVEL_INDEX_SHIFT), mapLevel: 11, levelsLeft: 1 })
  w.addPage(0, o.level ?? 0, [64, 64], { secondary: true })
  w.list('separable', [0])
  for (let y = 0; y < VSM_FILTERABLE_PAGE_SIZE; y++)
    for (let x = 0; x < VSM_FILTERABLE_PAGE_SIZE; x++) {
      if (x < SIDE && y < SIDE) w.setByte(w.world.vsmFilterableTemp, 0, x, y, o.current)
      const previous = o.previous === 'ramp' ? x : o.previous
      w.setByte(w.world.vsmPrevFilterableSeparate, 5, x, y, previous)
    }
  const covered = o.cover !== undefined
  const previous = { mapLevel: 10, levelsLeft: 2, flags: covered ? w.consts.VSM_MAP_COVERAGE : 0 }
  w.addPreviousMap(0, { ...previous, to: o.to, shift: o.shift, origin: o.shift })
  w.addPreviousMap(1, { ...previous, mapLevel: 11, levelsLeft: 1 })
  w.addPreviousPage(0, [64, 64], 5, o.secondary ?? true)
  if (covered) w.addPreviousCover(0, [64, 64], [0, 0], o.cover!)
  if (o.previousId !== undefined) w.history.previousId(0, o.previousId)
  w.history.blend(o.blend ?? BLEND)
  w.runLine('filterableY', [TEXEL, 0, 0], [SIDE, 1, 1], [TEXEL])
  return w.getByte(w.world.vsmFilterableSeparate, 0, TEXEL + 1, TEXEL + 1)
}

test('the history blend moves the value toward the previous frame’s by (1 - blend)', () => {
  // The share of the difference kept: 0 lit now, 1 before: 1 - 0.13; the other way, 0.13.
  assert.equal(blended({ current: 0, previous: 255, previousId: 0 }), 222)
  assert.equal(blended({ current: 255, previous: 0, previousId: 0 }), 33)
  assert.equal(blended({ current: 90, previous: 200, previousId: 0 }), after(90, 200))
  // The blend is the history's own word: none, the value stays.
  assert.equal(blended({ current: 0, previous: 255, previousId: 0, blend: 0 }), 0)
})

test('a change under a 255th moves a whole 255th, an equal value stays', () => {
  // A step of 2 bytes would move by 0.13 of it: a 255th is the least, toward the current value.
  assert.equal(blended({ current: 129, previous: 130, previousId: 0 }), 129)
  assert.equal(blended({ current: 130, previous: 128, previousId: 0 }), 129)
  assert.equal(blended({ current: 77, previous: 77, previousId: 0 }), 77)
})

test('the previous id is that of the clipmap’s first level: a page of the second level finds it too', () => {
  assert.equal(blended({ current: 0, previous: 255, previousId: 0, level: 1 }), 222)
  // The ids are by the first level's current id: with none for it, no blend.
  assert.equal(blended({ current: 0, previous: 255, level: 1 }), 0)
})

test('no previous frame’s value, no blend: no id, a page that was no secondary request, a cover without the texel', () => {
  const none = { current: 40, previous: 200 }
  assert.equal(blended({ ...none }), 40, 'no previous id')
  assert.equal(blended({ ...none, previousId: 0, secondary: false }), 40, 'not a secondary request')
  assert.equal(blended({ ...none, previousId: 0, cover: 0 }), 40, 'the cover lacks the texel')
  // The texel (10, 10) is the first bit of the half page's 4 x 4: with it the value blends.
  assert.equal(blended({ ...none, previousId: 0, cover: 1 }), after(40, 200))
  assert.equal(blended({ ...none, previousId: 0, cover: 2 }), 40, 'another bit')
})

test('the previous frame’s place is found through its map’s transform and its origin shift', () => {
  // The previous frame's map is 64 texels over in x: the place is its texel 64 on, in the page the
  // same; the previous bytes are a ramp in x, so the byte read is the 75th.
  const moved = new Mat(orthoMap().m.map((x, i) => (i === 12 ? x + 64 / 16384 : x)))
  assert.equal(blended({ current: 0, previous: 'ramp', previousId: 0, to: moved }), after(0, 75))
  // Or its frame is shifted by 64 along x, the clipmap's origin with it: the same place.
  const shifted = blended({ current: 0, previous: 'ramp', previousId: 0, shift: [64, 0, 0] })
  assert.equal(shifted, after(0, 75))
  // And no move: the place is the texel itself, the byte 11 of the ramp.
  assert.equal(blended({ current: 0, previous: 'ramp', previousId: 0 }), after(0, 11))
})

test('the hand-made bilinear read matches the f32 one within a 255th, clamped to the page', () => {
  const w = filterableWorld()
  const { vsmPrevFilterableSeparateBilinear: read } = shaderRun<{
    vsmPrevFilterableSeparateBilinear: (page: number, p: number[]) => number
  }>(w.kernels.filterableY.code, ['vsmPrevFilterableSeparateBilinear'], { ...w.consts, ...w.world })
  const rand = mulberry32(5)
  const bytes = new Uint8Array(VSM_FILTERABLE_PAGE_SIZE ** 2)
  for (let y = 0; y < VSM_FILTERABLE_PAGE_SIZE; y++)
    for (let x = 0; x < VSM_FILTERABLE_PAGE_SIZE; x++) {
      const value = Math.floor(rand() * 256)
      bytes[y * VSM_FILTERABLE_PAGE_SIZE + x] = value
      w.setByte(w.world.vsmPrevFilterableSeparate, 3, x, y, value)
    }
  const at = (x: number, y: number) => {
    const clamped = (i: number) => Math.min(Math.max(i, 0), VSM_FILTERABLE_PAGE_SIZE - 1)
    return bytes[clamped(y) * VSM_FILTERABLE_PAGE_SIZE + clamped(x)] / 255
  }
  const reference = (px: number, py: number) => {
    const [fx, fy] = [px - 0.5, py - 0.5]
    const [x, y] = [Math.floor(fx), Math.floor(fy)]
    const [u, v] = [fx - x, fy - y]
    const top = at(x, y) * (1 - u) + at(x + 1, y) * u
    const bottom = at(x, y + 1) * (1 - u) + at(x + 1, y + 1) * u
    return top * (1 - v) + bottom * v
  }
  const edge = VSM_FILTERABLE_PAGE_SIZE
  // A place in texels from the corner of the page's inner texels, the border one texel out.
  const places: number[][] = [
    ...[
      [0.2, 0.2],
      [edge - 0.1, edge - 0.3],
      [64, 64],
    ],
    ...[
      [64.5, 0.5],
      [1, 129.4],
    ],
  ]
  for (let k = 0; k < 200; k++) places.push([1 + rand() * 128, 1 + rand() * 128])
  for (const [x, y] of places)
    assert.ok(Math.abs(read(3, [x - 1, y - 1]) - reference(x, y)) <= 1 / 255, `(${x}, ${y})`)
  // On a texel centre, the byte itself.
  assert.equal(read(3, [10.5, 19.5]), at(11, 20))
})

test('a group takes its map’s UV and depth back to its frame once, an orthographic one with any axes', () => {
  // Columns of a turned, scaled, shifted map (last row 0 0 0 1).
  const m = new Mat([
    ...[0.0002, 0.0001, 0.00003, 0, -0.0001, 0.0003, 0.00005, 0],
    ...[0.00002, -0.00004, 0.4, 0, 0.3, 0.6, 0.1, 1],
  ])
  const w = filterableWorld()
  w.addMap(0, { flags: VSM_MAP_PREFILTERED_DISTANT, to: m, range: [0.4, 0.6] })
  w.addPage(0, 0, [64, 64], { secondary: true })
  w.history.previousId(0, 0)
  const { vsmFilterableBlendSetup: setup } = shaderRun<{
    vsmFilterableBlendSetup: (info: unknown) => void
  }>(w.kernels.filterableY.code, ['vsmFilterableBlendSetup'], { ...w.consts, ...w.world })
  setup(w.world.vsmPoolPageInfo[0])
  const group = w.world.vsmBlendGroup as { fromMap: Mat3; uvOffset: number[]; depth: number }
  assert.equal(group.depth, 0.5)
  const p = [123.5, -48.25, 0.75]
  const column = (c: number) => m.m.slice(4 * c, 4 * c + 3)
  const along = (i: number) => p.reduce((sum, x, c) => sum + column(c)[i] * x, column(3)[i])
  const uvz = [along(0), along(1), along(2)]
  const back = matrixProduct(
    group.fromMap,
    uvz.map((x, i) => x - group.uvOffset[i]),
  ) as number[]
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - p[i]) < 1e-6, `axis ${i}: ${back[i]}`)
})
