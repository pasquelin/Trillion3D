// The tessellation's WGSL (patches, edge factors, displacement fade, dicing) run on the shader kit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { PATTERN_FLIP } from './tessellation/contract.ts'
import { patchRun } from './patchRun.fixture.ts'
import { patternIndex } from './tessellation/patternIndex.fixture.ts'
import * as D from './tessellation/domainWgsl.ts'
import { diceSource } from './tessellation/diceWgsl.ts'
import { splitSource } from './tessellation/splitWgsl.ts'
import { functionsOf } from '../materials/texture/shaderRule.fixture.ts'

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
    run.edgeFactors(corners, [5, 5, 8], 0.1, perspective, 3, 0.5, far, 0)
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

test('a patch that crosses the near plane has finite factors, counted on its part in front', () => {
  const run = patchRun()
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  const near = 0.01
  // Depths -0.3, 0.2 and -0.1: the first edge crosses the plane and keeps (0.2 - near) / 0.5 of its length, the second (0.2 - near) / 0.3 of its
  // length, the third lies wholly behind it. The nearer end of a part in front is the plane itself.
  const f = run.edgeFactors(corners, [-0.3, 0.2, -0.1], near, true, 3, 0.5, 0, 0)
  const counted = (length: number, kept: number) => (length * kept * 3 * 0.5) / near
  const close = (a: number, b: number) =>
    assert.ok(Math.abs(a - b) <= 1e-4 * b, `${a} against ${b}`)
  close(f[0]!, counted(1, (0.2 - near) / 0.5))
  close(f[1]!, counted(Math.SQRT2, (0.2 - near) / 0.3))
  assert.equal(f[2], 0)
  assert.ok(f.every(Number.isFinite))
  // None is more than the whole edge over the plane would ask.
  assert.ok(f[0]! <= counted(1, 1) && f[1]! <= counted(Math.SQRT2, 1))
  // An edge wholly in front keeps its whole length: the rule is unchanged there.
  close(
    run.edgeFactors(corners, [0.5, 0.5, 0.5], near, true, 3, 0.5, 0, 0)[0]!,
    (1 * 3 * 0.5) / 0.5,
  )
  // A surface displaced by up to 0.3 m, lying in the plane of the eye: it reaches the near plane, and each edge is measured at `near + reach`.
  const reaching = run.edgeFactors(corners, [0, 0, 0], near, true, 3, 0.5, 0, 0.3)
  close(reaching[0]!, (1 * 3 * 0.5) / (near + 0.3))
  close(reaching[1]!, (Math.SQRT2 * 3 * 0.5) / (near + 0.3))
  // An edge in front of the near plane at both ends is the reference's whatever the reach: its whole length over its nearer end's depth.
  const front = run.edgeFactors(corners, [0.02, 0.5, 0.5], near, true, 3, 0.5, 0, 0.3)
  close(front[0]!, run.edgeFactors(corners, [0.02, 0.5, 0.5], near, true, 3, 0.5, 0, 0)[0]!)
  close(front[0]!, (1 * 3 * 0.5) / 0.02)
  // Undisplaced, the same patch is wholly behind the plane.
  assert.deepEqual(run.edgeFactors(corners, [0, 0, 0], near, true, 3, 0.5, 0, 0), [0, 0, 0])
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
  setDensity(low: number[], high: number[], scale: number, set: number): number
}
const domainRun = () =>
  shaderRun<Domain>(
    wgslBlock(
      'domainTest',
      [D.fadeLine, D.pointDisplacement, D.displacedClip, D.setDensity, D.uvDerivative],
      '',
    ),
    ['fadeLine', 'pointDisplacement', 'displacedClip', 'setDensity', 'uvDerivative'],
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
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((set) => run.setDensity([2, 0, 0.5, 8], [0, 4, 0, 1], 3, set)),
    [6, 3, 1.5, 24, 3, 12, 3, 3],
  )
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
  assert.match(kept, /d\.maskDensity/)
  assert.match(kept, /maskKeep\(page,uv\*at\.b,dot\(alpha,at\.b\)/)
  // A vertex it does not keep is as one behind the camera: the micro-triangles that use it are not drawn. The image's target drops what lies
  // before the near plane (`NEAR_DROP`); the shadow maps' cut or keep it, and only the target that cuts holds the clip positions and `diceNear`.
  assert.match(
    dice,
    /usable\[v\]=select\(0u,1u,kept&&\(item\.near!=0u\|\|\(clip\.w>0\.0&&sub\.z<=1\.0\)\)\);/,
  )
  assert.doesNotMatch(code, /clipOf|diceNear/)
  assert.match(
    code,
    /DiceItem\(row,mainView\(\),determinant\(worldMatrix3\(pages\[row\]\.world\)\),0u\)/,
  )
  // And no pixel is tested: the micro-triangle's pixel write is the one the unmasked rows have.
  assert.doesNotMatch(functionsOf(code, ['microPixel']), /maskKeep/)
})

test('a displaced patch’s box holds every point its cone of normals can move a corner to, where the reference’s two products would leave a cone that straddles an axis short', () => {
  const run = patchRun()
  const box = { lo: [0, 0, 0], hi: [1, 1, 1] }
  // The reference's bound (`DisplaceBounds`): the cap of the cone over an axis times the displacement end that matches its sign, two
  // products, and the other side of the axis mirrored. The cone's cap runs from `cos(a + c)` to `cos(a - c)`, one where it holds the axis.
  const reference = (center: number[], coneCos: number, dMin: number, dMax: number) =>
    center.map((x, axis) => {
      const a = coneCos * Math.abs(x)
      const b = Math.sqrt(Math.max(0, 1 - coneCos ** 2) * Math.max(0, 1 - x ** 2))
      const capMin = a - b
      const capMax = Math.abs(x) >= coneCos ? 1 : a + b
      const low = (dMin > 0 ? capMin : capMax) * dMin
      const high = (dMax > 0 ? capMax : capMin) * dMax
      return x >= 0
        ? [box.lo[axis] + low, box.hi[axis] + high]
        : [box.lo[axis] - high, box.hi[axis] - low]
    })
  // A cone of 60 degrees about +y, displaced by 0 to 1: its normals' x component runs from -0.87 to 0.87, so the corner moves that far
  // either way along x. The reference's low end of x stays at the box's (its minimum displacement is 0): the points moved toward -x are
  // outside its box.
  const center = [0, 1, 0],
    coneCos = Math.cos(Math.PI / 3)
  const mine = run.boxGrownByDisplacement(center, coneCos, 0, 1, box)
  const theirs = reference(center, coneCos, 0, 1)
  const reach = Math.sin(Math.PI / 3)
  assert.ok(mine.lo[0]! <= -reach + 1e-6 && mine.hi[0]! >= 1 + reach - 1e-6, 'x: both sides')
  assert.ok(theirs[0]![0]! > -reach, 'the reference’s x stops short of the point the cone reaches')
  // The box holds every sampled normal of the cone at every displacement of the range, on all three axes.
  for (let theta = 0; theta <= Math.PI / 3 + 1e-9; theta += Math.PI / 60)
    for (let turn = 0; turn < 2 * Math.PI; turn += Math.PI / 12)
      for (const d of [0, 0.25, 1]) {
        const n = [
          Math.sin(theta) * Math.cos(turn),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(turn),
        ]
        for (let k = 0; k < 3; k++) {
          for (const corner of [box.lo[k]!, box.hi[k]!]) {
            const point = corner + n[k]! * d
            assert.ok(point >= mine.lo[k]! - 1e-6 && point <= mine.hi[k]! + 1e-6, `axis ${k}`)
          }
        }
      }
})

test('the image lists a visible patch with one count; the shadow maps’ layers reserve their room first, then count in their run', () => {
  const list = functionsOf(splitSource(), ['listVisible'])
  // A chain that is not layered counts the patch once, in the visible counter, and keeps it at that slot of the region.
  assert.match(
    list,
    /if\(tu\.layered==0u\)\{\s*let slot=atomicAdd\(&tess\[tu\.args\+1u\],1u\);\s*if\(slot>=tu\.maxVisible\)\{atomicAdd\(&tess\[tu\.lost\+1u\],1u\);return;\}/,
  )
  assert.match(list, /storePatch\(tu\.visible\+slot\*4u,p\);\s*return;/)
  // A layered chain reserves its room against the capacity (the loss counted past it), then counts in its layer's counter and slots from its run.
  assert.match(list, /atomicAdd\(&tess\[tu\.args\+8u\],1u\)>=tu\.maxVisible/)
  assert.match(list, /atomicAdd\(&tess\[tu\.args\+listCounter\(layer\)\],1u\)/)
  assert.match(list, /storePatch\(tu\.visible\+listSlot\(layer,slot\)\*4u,p\)/)
})
