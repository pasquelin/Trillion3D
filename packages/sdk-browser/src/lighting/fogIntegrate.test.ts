// The fog volume's integration and its furthest depth, run as shipped (`shaderRun`) on a volume of
// 20 × 12 × 8 cells over a view of 160 × 90 pixels: the sum along a column against the sum written out
// step by step, the furthest depth of a cell against the pyramid's own steps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { cellGrid } from './fog/layout.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import { FOG_FURTHEST_WGSL } from './fog/integrateWgsl.ts'
import { FOG_FRAME_STRUCT_WGSL } from './fog/readWgsl.ts'
import {
  CAM,
  GRID,
  frameScope,
  image,
  pointOf,
  sub,
  table,
  type V3,
} from './fogVolumeRun.fixture.ts'

/** The furthest depth's program over a pyramid of `levels` levels, whose cells a test table answers
 *  (`hizCellFarthest`, the depth pyramid's own read, by level and cell). */
const furthestProgram = (levels: number) =>
  wgslProgram(
    `@group(0) @binding(2) var<uniform> frame:FogVolumeFrame;
@group(0) @binding(10) var fogFurthestOut:texture_storage_2d<r32float,write>;
@group(0) @binding(0) var pyramid:texture_2d_array<f32>;
fn hizLevelCount()->i32{return ${levels};}
fn hizCellFarthest(cell:vec2i,level:i32)->f32{return textureLoad(pyramid,cell,level,0).r;}`,
    [FOG_FRAME_STRUCT_WGSL, FOG_FURTHEST_WGSL],
  )

/** Cells of 7 pixels over the view: not a power of two, so a cell's rectangle aligns to the pyramid's
 *  blocks by chance, as a cell of the grid raised past the texture limit does. */
const SIDE = 7
const GRID7 = cellGrid(CAM.width, CAM.height, SIDE, 8)
const PLAIN = {
  volumetricFogSkipHidden: false,
  volumetricFogUsesHistory: false,
}

test('a medium thinner than a thousandth per metre divides its light by the thousandth', () => {
  const img = image(CAM, true, PLAIN)
  const thin = 1e-5
  const out = table()
  const run = shaderRun<{ integrateMain: (id: V3) => void }>(
    FOG_PROGRAMS.integrate,
    ['integrateMain'],
    {
      frame: frameScope(img),
      fogScatterIn: table(() => [0.2, 0.1, 0.05, thin]),
      fogIntegrated: out,
    },
  )
  run.integrateMain([3, 4, 0])
  const here = pointOf([3, 4, 0])
  const step = Math.hypot(...sub(here, pointOf([3, 4, 0], [0.5, 0.5, 0])))
  const [r] = out.cells.get('3,4,0') as number[]
  // The light of the first cell: its scattering over the step, `(1 − e^(−e·d)) / max(e, 10⁻³)`.
  near([r], [(0.2 * (1 - Math.exp(-thin * step))) / 1e-3], 'the guard', 1e-6)
})

test('the sum along a column: the light conserved, the transmittance the product of the steps', () => {
  const img = image(CAM, true, PLAIN)
  const column = table((c) => [0.2, 0.1, 0.05, 0.5 + 0.01 * c[2]])
  const out = table()
  const run = shaderRun<{ integrateMain: (id: V3) => void }>(
    FOG_PROGRAMS.integrate,
    ['integrateMain'],
    {
      frame: frameScope(img),
      fogScatterIn: column,
      fogIntegrated: out,
    },
  )
  run.integrateMain([3, 4, 0])
  // Step by step: the same sum written out, the fade-in off (no fade-in distance).
  let light = [0, 0, 0],
    kept = 1,
    before = pointOf([3, 4, 0], [0.5, 0.5, 0])
  for (let z = 0; z < GRID.z; z++) {
    const here = pointOf([3, 4, z])
    const step = Math.hypot(...sub(here, before))
    const e = 0.5 + 0.01 * z
    const through = Math.exp(-e * step)
    light = light.map((l, c) => l + (([0.2, 0.1, 0.05][c] * (1 - through)) / e) * kept)
    kept *= through
    before = here
    near(out.cells.get(`3,4,${z}`) as number[], [...light, kept], `slice ${z}`, 1e-6)
  }
})

/** The furthest depth of a cell by the pyramid's own steps, written from its description: the
 *  rectangle of the cell's pixels and half a cell around them, its pixel centres, the blocks of
 *  two-by-two at the level four of them cover, the least depth over those blocks' pixels. */
function furthestAround(
  cell: [number, number],
  depth: (x: number, y: number) => number,
  side: number,
) {
  const view = [CAM.width, CAM.height]
  // The frame holds the inverse of the view's size as a 32-bit float: so does this description.
  const tile = [2 * side * Math.fround(1 / view[0]), -2 * side * Math.fround(1 / view[1])]
  const a = [(cell[0] - 0.5) * tile[0] - 1, (cell[1] - 0.5) * tile[1] + 1]
  const b = [(cell[0] + 1.5) * tile[0] - 1, (cell[1] + 1.5) * tile[1] + 1]
  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
  const uv = [
    clamp01(x0 * 0.5 + 0.5),
    clamp01(y1 * -0.5 + 0.5),
    clamp01(x1 * 0.5 + 0.5),
    clamp01(y0 * -0.5 + 0.5),
  ]
  let px = [
    uv[0] * view[0] + 0.5,
    uv[1] * view[1] + 0.5,
    uv[2] * view[0] - 0.5,
    uv[3] * view[1] - 0.5,
  ].map(Math.trunc)
  px = [
    Math.max(px[0], 0),
    Math.max(px[1], 0),
    Math.min(px[2], view[0] - 1),
    Math.min(px[3], view[1] - 1),
  ]
  let t = [px[0] >> 1, px[1] >> 1, Math.max(px[0], px[2]) >> 1, Math.max(px[1], px[3]) >> 1]
  const high = (n: number) => (n <= 0 ? -1 : 31 - Math.clz32(n))
  let level = Math.max(Math.max(high(t[2] - t[0]), high(t[3] - t[1])) - 1, 0)
  const extra = (t[2] >> level) - (t[0] >> level) > 3 || (t[3] >> level) - (t[1] >> level) > 3
  if (extra) level++
  t = t.map((n) => n >> level)
  const [fx, fy] = [t[0] << (level + 1), t[1] << (level + 1)]
  const [lx, ly] = [
    Math.min(((t[2] + 1) << (level + 1)) - 1, view[0] - 1),
    Math.min(((t[3] + 1) << (level + 1)) - 1, view[1] - 1),
  ]
  let least = 1
  for (let y = fy; y <= ly; y++) for (let x = fx; x <= lx; x++) least = Math.min(least, depth(x, y))
  return { least, extra }
}

/** The pyramid of `depth` over the view, as the program reads it: a cell of level `l` holds the
 *  least depth over the block of `2^l` pixels a side it covers, the edge cells clamped. */
const pyramidOf = (depth: (x: number, y: number) => number) => ({
  load: ([x, y]: number[], level: number) => {
    const side = 2 ** level
    const [cx, cy] = [
      Math.min(x, Math.ceil(CAM.width / side) - 1),
      Math.min(y, Math.ceil(CAM.height / side) - 1),
    ]
    let least = 1
    for (let py = cy * side; py < Math.min((cy + 1) * side, CAM.height); py++)
      for (let px = cx * side; px < Math.min((cx + 1) * side, CAM.width); px++)
        least = Math.min(least, depth(px, py))
    return [least, 0, 0, 0]
  },
})

test('a pyramid too short to hold the footprint holds nothing behind: the furthest depth is nil', () => {
  const out = table()
  const run = shaderRun<{ furthestMain: (id: number[]) => void }>(
    furthestProgram(1),
    ['furthestMain'],
    {
      frame: frameScope(image(CAM, true, {}, { grid: GRID7 })),
      pyramid: pyramidOf(() => 0.5),
      fogFurthestOut: out,
    },
  )
  run.furthestMain([4, 4, 0])
  assert.deepEqual(out.cells.get('4,4'), [0, 0, 0, 0])
})

test('the furthest depth of a cell is the furthest of the blocks the pyramid would read for it', () => {
  // A depth that varies from pixel to pixel, so that the footprint read is the footprint asked.
  const depth = (x: number, y: number) =>
    0.3 + 0.2 * Math.sin(x * 0.7) * Math.cos(y * 1.3) + 0.001 * x
  const out = table()
  const run = shaderRun<{ furthestMain: (id: number[]) => void }>(
    furthestProgram(8),
    ['furthestMain'],
    {
      frame: frameScope(image(CAM, true, {}, { grid: GRID7 })),
      pyramid: pyramidOf(depth),
      fogFurthestOut: out,
    },
  )
  // A grid of 7-pixel cells. The cells the pyramid reads one level coarser for, because of how they align to its blocks, are
  // among those checked.
  const all = Array.from(
    { length: GRID.x * GRID.y },
    (_, i) => [i % GRID.x, Math.floor(i / GRID.x)] as [number, number],
  )
  const aligned = all.filter((cell) => furthestAround(cell, depth, SIDE).extra).slice(0, 3)
  assert.equal(aligned.length, 3)
  for (const cell of [
    [0, 0],
    [5, 5],
    [GRID7.x - 1, GRID7.y - 1],
    [10, 0],
    [0, GRID7.y - 1],
    [7, 3],
    ...aligned,
  ] as [number, number][]) {
    run.furthestMain([...cell, 0])
    near(
      out.cells.get(cell.join(',')) as number[],
      [furthestAround(cell, depth, SIDE).least, 0, 0, 0],
      `cell ${cell}`,
      1e-6,
    )
  }
})
