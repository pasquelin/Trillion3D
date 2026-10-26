// The fog volume's integration and its furthest depth, run as shipped (`shaderRun`) on a volume of
// 20 × 12 × 8 cells over a view of 160 × 90 pixels: the sum along a column against the sum written out
// step by step, the furthest depth of a cell against the pyramid's own steps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import { subtract } from '../../../math/src/vector/vectorTuple.ts'
import type { ResolvedHeightFog } from '../../../sdk-core/src/scene/core/fogHeight.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { cellGrid } from './fog/layout.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import { fogBlockOf } from './fog/readWgsl.ts'
import { FOG_FURTHEST_WGSL } from './fog/integrateWgsl.ts'
import { FOG_FRAME_STRUCT_WGSL } from './fog/readWgsl.ts'
import { CAM, GRID, frameScope, image, pointOf, table, type V3 } from './fogVolumeRun.fixture.ts'
import { hizCellSpan } from '../../../sdk-core/src/hiz/oracles.fixture.ts'
import { scatter } from './fogScatterRun.fixture.ts'
import { HEIGHT, RGB, wgslFogged } from './fogShaderRun.fixture.ts'

/** The furthest depth's program over a pyramid of `levels` levels, whose cells a test table answers
 *  (`hizCellCullFarthest`, the depth pyramid's own read, by level and cell). */
const furthestProgram = (levels: number) =>
  wgslProgram(
    `@group(0) @binding(2) var<uniform> frame:FogVolumeFrame;
@group(0) @binding(10) var fogFurthestOut:texture_storage_2d<r32float,write>;
@group(0) @binding(0) var pyramid:texture_2d_array<f32>;
fn hizLevelCount()->i32{return ${levels};}
fn hizOpaqueDepth(cell:vec2i)->f32{return textureLoad(pyramid,cell,0,0).r;}
fn hizCellCullFarthest(cell:vec2i,level:i32)->f32{return textureLoad(pyramid,cell,level,0).r;}`,
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
  const step = Math.hypot(...subtract(here, pointOf([3, 4, 0], [0.5, 0.5, 0])))
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
    const step = Math.hypot(...subtract(here, before))
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
 *  least depth over the block of `2^l` pixels a side it covers, the edge cells clamped (the last one
 *  also holding the image's last two pixels, `hizCellSpan`). */
const pyramidOf = (depth: (x: number, y: number) => number) => ({
  load: ([x, y]: number[], level: number) => {
    const side = 2 ** level
    const [cx, cy] = [
      Math.min(x, Math.ceil(CAM.width / side) - 1),
      Math.min(y, Math.ceil(CAM.height / side) - 1),
    ]
    const [x0, x1] = hizCellSpan(cx, level, CAM.width)
    const [y0, y1] = hizCellSpan(cy, level, CAM.height)
    let least = 1
    for (let py = y0; py < y1; py++)
      for (let px = x0; px < x1; px++) least = Math.min(least, depth(px, py))
    return [least, 0, 0, 0]
  },
})

test('a footprint wider than a short pyramid reads its last level: the image’s furthest depth', () => {
  const out = table()
  // Two levels: the depth itself and one texel, 0.3; the footprint of a cell reaches past level 1.
  const run = shaderRun<{ furthestMain: (id: number[]) => void }>(
    furthestProgram(2),
    ['furthestMain'],
    {
      frame: frameScope(image(CAM, true, {}, { grid: GRID7 })),
      pyramid: { load: (_c: number[], level: number) => [level === 0 ? 0.9 : 0.3, 0, 0, 0] },
      fogFurthestOut: out,
    },
  )
  run.furthestMain([4, 4, 0])
  assert.deepEqual(out.cells.get('4,4'), [0.3, 0, 0, 0])
  // A pyramid of the depth alone — an image of one pixel — reads the depth.
  const flat = table()
  shaderRun<{ furthestMain: (id: number[]) => void }>(furthestProgram(1), ['furthestMain'], {
    frame: frameScope(image(CAM, true, {}, { grid: GRID7 })),
    pyramid: { load: () => [0.9, 0, 0, 0] },
    fogFurthestOut: flat,
  }).furthestMain([4, 4, 0])
  assert.deepEqual(flat.cells.get('4,4'), [0.9, 0, 0, 0])
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

/** The ratio of the volume's optical depth to the analytic fog's, whatever the medium: half the density's integral
 *  over `(ln 2)²` times it. */
const VOLUME_TO_ANALYTIC = 0.5 / Math.LN2 ** 2

/** The optical depth of the column `column` of the volume the scatter and the integration give, the
 *  analytic fog's over the same stretch of the same ray — from the front of the first slice to the centre
 *  of the last, the fog the scene declares being a height fog of `density` and `falloff`, black —, and
 *  the volume's own law integrated finely along it: half the density, per metre. */
function columnDepths(column: [number, number], density: number, falloff: number) {
  const cells = Array.from({ length: GRID.z }, (_, z) => [...column, z] as V3)
  const stored = cells.map((cell) => scatter(cell, { density, falloff })!)
  const out = table()
  shaderRun<{ integrateMain: (id: V3) => void }>(FOG_PROGRAMS.integrate, ['integrateMain'], {
    frame: frameScope(image(CAM, true, PLAIN)),
    fogScatterIn: table((c) => stored[c[2]]),
    fogIntegrated: out,
  }).integrateMain([...column, 0])
  const [front, last] = [pointOf([...column, 0], [0.5, 0.5, 0]), pointOf(cells[GRID.z - 1])]
  const [, , , kept] = out.cells.get(cells[GRID.z - 1].join(',')) as number[]
  const fog: ResolvedHeightFog = {
    ...HEIGHT,
    color: [0, 0, 0],
    baseDensity: density,
    falloff,
    baseHeight: 0,
  }
  const clear = { ...fog, startDistance: 0, cutoffDistance: 0, maxOpacity: 1 }
  const analytic = wgslFogged(clear, RGB, last, front)[0] / RGB[0]
  // The volume's law by 20 000 steps: half the density at the height of each.
  const length = Math.hypot(...subtract(last, front))
  let exact = 0
  for (let i = 0, n = 20000; i < n; i++) {
    const y = front[1] + ((i + 0.5) / n) * (last[1] - front[1])
    exact += 0.5 * density * 2 ** (-falloff * y) * (length / n)
  }
  const heights = cells.map((cell) => pointOf(cell)[1])
  const rise = Math.max(...heights.map((y, z) => Math.abs(y - (heights[z - 1] ?? y))))
  return { volume: -Math.log(kept), analytic: -Math.log(analytic), exact, rise }
}

test('the volume and the analytic fog are one law: the same density, read as an exponent of two or as an extinction of half of it', () => {
  for (const [column, falloff] of [
    [[7, 5], 0],
    [[7, 1], 0.03],
  ] as const) {
    const { volume, analytic, exact, rise } = columnDepths([...column], 0.04, falloff)
    // The analytic fog's optical depth over the volume's, whatever the falloff, is the units' ratio alone:
    // (ln 2)² over a half. The shipped fog agrees with the law integrated finely to the float's rounding.
    near([(analytic * VOLUME_TO_ANALYTIC) / exact], [1], `falloff ${falloff}: the law`, 1e-4)
    // The cells sum the density at the centre of each step's far end, an error of at most half the share
    // of the density a step's rise changes — `falloff · ln 2 · rise` — and none where the medium is uniform.
    const tolerance = (falloff * Math.LN2 * rise) / 2
    assert.ok(tolerance < 0.05, `the widest step rises ${rise} m: a coarse grid, a loose tolerance`)
    near([volume / exact], [1], `falloff ${falloff}: the cells`, tolerance + 1e-5)
  }
  assert.ok(Math.abs(VOLUME_TO_ANALYTIC - 1.0407) < 1e-4, 'half the density is (ln 2)² to 4 %')
})

test('the law is written once: the analytic fog and the volume’s cells read a layer’s density through one function, neither spells its exponential', () => {
  const analytic = wgslProgram('', [fogBlockOf({ group: 0 })])
  // The analytic fog reads a layer's density where a ray starts, the volume's cell the medium's at its height.
  for (const [name, code, call] of [
    ['the analytic fog', analytic, 'fogLayerDensity(layer,z,-125.0,126.0)'],
    ['the volume’s scatter', FOG_PROGRAMS.scatter, 'fogDensityAt(fogCellPoint('],
  ] as const) {
    assert.equal(code.match(/fn fogLayerDensity\(/g)?.length, 1, `${name} declares the law once`)
    assert.ok(code.includes(call), `${name} calls it`)
    // The density by height is spelt there and nowhere else: no other `exp2` of a layer's falloff.
    assert.equal(code.match(/exp2\(clamp\(-layer\.y/g)?.length, 1, `${name}: the one spelling`)
    assert.ok(!/exp2\(-(first|second|layer)\.y/.test(code), `${name}: no other`)
  }
})
