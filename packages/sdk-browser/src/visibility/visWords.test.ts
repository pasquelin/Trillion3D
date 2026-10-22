// Every pass decodes a visibility identifier with `visPageIndex` and `visTriangle`, printed from the
// layout's constants: the shipped WGSL inverts the encode `(row + 1) << VIS_TRIANGLE_BITS | tri`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../materials/texture/shaderRunMatrix.fixture.ts'
import {
  VIS_MAX_PAGE_TRIANGLES,
  VIS_TRIANGLE_BITS,
  VIS_TRIANGLE_MASK,
  visPageIndex,
  visTriangle,
} from './visWords.ts'
import { VOXEL_BRICK_TRIANGLES, VOXEL_PAGE_BRICKS } from '../../../sdk-core/src/page/voxelPage.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { PATTERN_FLIP, patternIndex } from './tessellation/contract.ts'
import * as P from './tessellation/patchWgsl.ts'
import * as D from './tessellation/domainWgsl.ts'
import { diceSource } from './tessellation/diceWgsl.ts'
import { functionsOf } from '../materials/texture/shaderRule.fixture.ts'

type Decode = (id: number) => number

test('the WGSL decode returns the row and the triangle an identifier was encoded with', () => {
  const { visPageIndex: row } = shaderRun<{ visPageIndex: Decode }>(
    visPageIndex,
    ['visPageIndex'],
    {},
  )
  const { visTriangle: tri } = shaderRun<{ visTriangle: Decode }>(visTriangle, ['visTriangle'], {})
  for (const [page, triangle] of [
    [0, 0],
    [3, 17],
    [65_535, VIS_TRIANGLE_MASK],
    [1_000_000, 128],
  ]) {
    const id = (((page + 1) << VIS_TRIANGLE_BITS) | triangle) >>> 0
    assert.equal(row(id) >>> 0, page)
    assert.equal(tri(id) >>> 0, triangle)
  }
})

// A voxel page draws its bricks' boxes (`voxelWgsl.ts`): its identifier names every box triangle
// of the bricks the compiler packs in one (`VOXEL_PAGE_BRICKS`, `voxel/page.rs`), and one brick
// more would not fit.
test("a voxel page's box triangles all fit a page's identifier", () => {
  assert.ok(VOXEL_PAGE_BRICKS * VOXEL_BRICK_TRIANGLES <= VIS_MAX_PAGE_TRIANGLES)
  assert.ok((VOXEL_PAGE_BRICKS + 1) * VOXEL_BRICK_TRIANGLES > VIS_MAX_PAGE_TRIANGLES)
})

type Run = {
  packCorner(b: number[]): number
  unpackCorner(e: number): number[]
  sortedFactors(f: number[]): { factors: number[]; corners: number[]; flip: boolean }
  patternOf(f: number[], flip: boolean): number
  edgeFactors(...args: unknown[]): number[]
  quarterRateDepth(...args: number[]): number
  boxGrownByDisplacement(...args: unknown[]): { lo: number[]; hi: number[] }
}
const patchRun = (scope: object = {}) =>
  shaderRun<Run>(
    wgslBlock(
      'patchTest',
      [
        P.packCorner,
        P.unpackCorner,
        P.sortedFactors,
        P.patternOf,
        P.edgeFactors,
        P.quarterRateDepth,
        P.boxGrownByDisplacement,
      ],
      '',
    ),
    [
      'packCorner',
      'unpackCorner',
      'sortedFactors',
      'patternOf',
      'edgeFactors',
      'quarterRateDepth',
      'boxGrownByDisplacement',
    ],
    scope,
  )

test('a patch’s corner survives its encoding to a word, and its three weights still sum to one', () => {
  const run = patchRun()
  for (const b of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.25, 0.5, 0.25],
    [1 / 3, 1 / 3, 1 / 3],
    [0.123456, 0.654321, 0.222223],
  ]) {
    const back = run.unpackCorner(run.packCorner(b))
    back.forEach((x, i) => assert.ok(Math.abs(x - b[i]!) < 1 / 32768, `${b} -> ${back}`))
    assert.ok(Math.abs(back[0]! + back[1]! + back[2]! - 1) < 1e-12)
  }
  // The third weight is what the other two leave: the largest of the three, so that its rounding
  // is the one the whole absorbs.
  assert.deepEqual(run.unpackCorner(run.packCorner([1 / 3, 1 / 3, 1 / 3])), [
    10923 / 32768,
    10923 / 32768,
    10922 / 32768,
  ])
  // The first of them, when it is the largest: 13107 + 9830 + 9830 is one short of the whole.
  assert.deepEqual(run.unpackCorner(run.packCorner([0.4, 0.3, 0.3])), [
    13108 / 32768,
    9830 / 32768,
    9830 / 32768,
  ])
})

test('the edges’ factors are rounded up to the table, the largest first, and index the pattern the host does', () => {
  const run = patchRun()
  assert.deepEqual(run.sortedFactors([3.2, 7.9, 5.1]), {
    factors: [8, 6, 4],
    corners: [1, 2, 0],
    flip: false,
  })
  assert.deepEqual(run.sortedFactors([0.2, 99, 14.5]), {
    factors: [14, 14, 1],
    corners: [1, 2, 0],
    flip: false,
  })
  for (const [a, b, c] of [
    [1, 2, 3],
    [3, 2, 1],
    [2, 9, 14],
    [14, 14, 14],
    [5, 5, 4.5],
  ] as const) {
    const sorted = run.sortedFactors([a, b, c]),
      [x, y, z] = sorted.factors
    assert.ok(x! >= y! && y! >= z!, `${[a, b, c]} sorted ${sorted.factors}`)
    // The corners the pattern's own are a permutation of the patch's, its factors the patch's
    // rounded up, and a winding turned an odd number of times is said so.
    assert.deepEqual([...sorted.corners].sort(), [0, 1, 2])
    const [ra, rb, rc] = [a, b, c].map(Math.ceil)
    assert.deepEqual(
      [...sorted.factors].sort((p, q) => p - q),
      [ra!, rb!, rc!].sort((p, q) => p - q),
    )
    const index = run.patternOf(sorted.factors, sorted.flip)
    assert.equal(index & 0xfff, patternIndex(ra!, rb!, rc!), `${[a, b, c]}`)
    assert.equal((index & PATTERN_FLIP) !== 0, sorted.flip)
  }
  // Two corners swapped: the first and third keep their places... the winding is reversed.
  assert.equal(run.sortedFactors([4, 2, 3]).flip, true)
  assert.equal(run.sortedFactors([4, 3, 2]).flip, false)
})

test('an edge is cut by its length over the depth of its nearer end, a quarter as finely past where the displacement fades', () => {
  const run = patchRun()
  const corners = [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
  ]
  const factors = (perspective: boolean, far: number) =>
    run.edgeFactors(corners, [5, 5, 8], 0.1, perspective, 3, 0.5, far)
  const near = (a: number[], b: number[]) =>
    a.forEach((x, i) => assert.ok(Math.abs(x - b[i]!) < 1e-9, `${a} against ${b}`))
  // The edges are 10, 10√2 and 10 long; their nearer ends are at depths 5, 5 and 5 (the last edge
  // runs from the corner at 8 to the one at 5); the pixels a unit subtends, 3, over the rate, 2.
  near(factors(true, 0), [3, 3 * Math.SQRT2, 3])
  // Orthographic: no division by depth.
  near(factors(false, 0), [15, 15 * Math.SQRT2, 15])
  // The edges that lie farther than 4 are cut a quarter as finely.
  near(factors(true, 4), [0.75, 0.75 * Math.SQRT2, 0.75])
  near(factors(true, 6), [3, 3 * Math.SQRT2, 3])
  // Where the displacement fades: the largest displacement over the pixels it fades out at.
  assert.equal(run.quarterRateDepth(0.5, 2, 100, 5), 20)
  assert.equal(run.quarterRateDepth(0.5, 2, 100, 0), 0)
})

type Domain = {
  pointDisplacement(
    point: object,
    height: number,
    scale: number[],
    fade: number[],
    shadow: boolean,
  ): number
  fadeLine(...args: unknown[]): number[]
  displacedClip(
    point: object,
    height: number,
    scale: number[],
    fade: number[],
    viewProj: object,
  ): number[]
  uvDerivative(...args: unknown[]): number
  setDensities(density: number[], scale: number): number[]
}
const domainRun = () =>
  shaderRun<Domain>(
    wgslBlock(
      'domainTest',
      [D.fadeLine, D.pointDisplacement, D.displacedClip, D.setDensities, D.uvDerivative],
      '',
    ),
    ['fadeLine', 'pointDisplacement', 'displacedClip', 'setDensities', 'uvDerivative'],
    {},
  )

test('a displacement fades along the depth between the sizes in pixels it is whole at and gone at', () => {
  const run = domainRun()
  // Magnitude 1, centre 0.5, whole at 4 pixels, gone at 2; the displacement spans 0.5 each way, the
  // object's scale 1, a pixel an edge (`edgesPerPixel` 1), the view 1000 pixels per unit at depth one.
  const record = [1, 0.5, 4, 2],
    bounds = [-0.5, 0.5, 2]
  const [slope, offset] = run.fadeLine(record, bounds, 1, 1000, 1, true)
  // Whole at 500 / 4 = 125, gone at 500 / 2 = 250: a line in the depth, saturated by the point.
  assert.ok(Math.abs(slope! * 125 + offset! - 1) < 1e-9 && Math.abs(slope! * 250 + offset!) < 1e-9)
  // Orthographic, where the depth is one: the amount there, the same everywhere (whole at 3 / 4,
  // gone at 3 / 2: at depth one, two thirds).
  const [still, amount] = run.fadeLine(record, bounds, 1, 6, 1, false)
  assert.ok(still === 0 && Math.abs(amount! - 2 / 3) < 1e-9)
  // A displacement that never fades is whole in both.
  assert.deepEqual(run.fadeLine([1, 0.5, 0, 0], bounds, 1, 1000, 1, true), [0, 1])
  assert.deepEqual(run.fadeLine([1, 0.5, 0, 0], bounds, 1, 1000, 1, false), [0, 1])
})

test('a point is pushed along its normal by the height over the centre times the magnitude, as much as the fade lets', () => {
  const run = domainRun()
  // A normal of length 2: the world is scaled twice.
  const point = { world: [0, 0, 0], normal: [0, 0, 2], uv: [0, 0], clip: [0, 0, 0, 10] }
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const clip = (height: number, fade: number[]) =>
    run.displacedClip(point, height, [2, 0.25, 0, 0], fade, identity)
  // (1 - 0.25) * 2 = 1.5 along it.
  assert.deepEqual(clip(1, [0, 1]), [0, 0, 3, 1])
  // Below the centre it goes in; the map's height is held to its range.
  assert.deepEqual(clip(0, [0, 1]), [0, 0, -1, 1])
  assert.deepEqual(clip(7, [0, 1]), [0, 0, 3, 1])
  // Faded by a half at its depth (w = 10): half of it.
  assert.deepEqual(clip(1, [-0.05, 1]), [0, 0, 1.5, 1])
})

test('in a shadow map a point the fade has not left whole takes the least displacement, not the faded one', () => {
  const run = domainRun()
  const point = { world: [0, 0, 0], normal: [0, 0, 1], uv: [0, 0], clip: [0, 0, 0, 10] }
  const record = [2, 0.25, 0, 0]
  // Whole (a fade of one at its depth): the height's own, in the image and in the shadow map.
  assert.equal(run.pointDisplacement(point, 1, record, [0, 1], false), 1.5)
  assert.equal(run.pointDisplacement(point, 1, record, [0, 1], true), 1.5)
  // Faded by a half at its depth (w = 10): the image halves it; the shadow map takes the least
  // displacement, -center * magnitude, whatever the height says — it does not shadow itself where
  // it fades out.
  assert.equal(run.pointDisplacement(point, 1, record, [-0.05, 1], false), 0.75)
  assert.equal(run.pointDisplacement(point, 1, record, [-0.05, 1], true), -0.5)
  assert.equal(run.pointDisplacement(point, 0, record, [-0.05, 1], true), -0.5)
})

test('the map is read at the level a micro-triangle’s edge asks, from the material’s density of the coordinate', () => {
  const run = domainRun()
  // The coordinate moves depth / (object units a unit covers * pixels per unit * rate): farther,
  // more per edge. The units a unit covers are the material's density at the object's scale, so two
  // triangles of one material, however they are stretched, ask the same level of the map.
  assert.equal(run.uvDerivative(8, 2, 100, 0.5, true), 8 / (2 * 100 * 0.5))
  assert.equal(run.uvDerivative(8, 2, 100, 0.5, false), 1 / (2 * 100 * 0.5))
  assert.equal(run.uvDerivative(8, 4, 100, 0.5, true), run.uvDerivative(8, 2, 100, 0.5, true) / 2)
  // The density of each set at the object's scale; a set the compiler measured none of reads 1.
  assert.deepEqual(run.setDensities([2, 0, 0.5, 8], 3), [6, 3, 1.5, 24])
})

test('the dicing reads a masked row’s cutout at each vertex, at its set’s density, and drops the micro-triangles of a vertex it cuts', () => {
  const code = diceSource()
  const dice = functionsOf(code, ['diceGroup'])
  // The row's coordinate and vertex alpha are read once for its three corners, only where it is masked.
  assert.match(
    dice,
    /if\(masked\)\{cutoutUv\[lane\]=pageMaskUv\(page,h,v\);cutoutAlpha\[lane\]=pageMaskAlpha\(page,h,v\);\}/,
  )
  // At each vertex, by its weights on the triangle, at the level of the density of the set the base
  // map reads: the one function the shadow maps' vertex stage calls too.
  assert.match(
    dice,
    /dicedKept\(page,d,view,at,mat3x2f\(cutoutUv\[0\],cutoutUv\[1\],cutoutUv\[2\]\)/,
  )
  const kept = functionsOf(code, ['dicedKept'])
  assert.match(kept, /d\.density\[pageMaskSet\(page\)\]/)
  assert.match(kept, /maskKeep\(page,uv\*at\.b,dot\(alpha,at\.b\)/)
  // A vertex it does not keep is as one behind the camera: the micro-triangles that use it are not drawn.
  assert.match(dice, /usable\[v\]=select\(0u,1u,kept&&clip\.w>0\.0&&sub\.z<=1\.0\);/)
  // And no pixel is tested: the micro-triangle's pixel write is the one the unmasked rows have.
  assert.doesNotMatch(functionsOf(code, ['microPixel']), /maskKeep/)
})
