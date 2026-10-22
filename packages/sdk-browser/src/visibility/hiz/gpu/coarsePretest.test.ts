import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_KERNEL_TEXELS } from '../counts.ts'
import {
  HIZ_TEST_VALUES,
  hizTestRect,
} from '../../../../../../bench/oracles/browser/hizOcclusion.ts'
import { packHizPyramid } from './oracle.fixture.ts'
import type { PackedHiz } from './oracle.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  PATCH_SIGHT_WGSL,
  SIGHT_GONE,
  SIGHT_HIDDEN,
  SIGHT_SEEN,
} from '../../tessellation/sightWgsl.ts'
import { OCCLUSION_MAIN, OCCLUSION_NONE, OCCLUSION_POST } from '../../tessellation/contract.ts'

// The Hi-Z rectangle test reads a coarse mip first and stops at the first texel that does not
// hide (`pyramidHides`), instead of taking the minimum of the whole footprint
// (`pyramidFar`). Below, both WGSL functions transcribed line by line, in f32, must return the
// same verdict on random pyramids, rectangles and depths, and on the hostile values:
// NaN, ±0, ±Inf, a one-texel pyramid, a footprint as wide as the kernel, a mip table cut short.
const KERNEL = HIZ_KERNEL_TEXELS

/** The mip that covers an already clipped rectangle, or -1: `hizTestRect`, the CPU rule
 *  `hizLevelFor` mirrors, over a viewport wide enough to clip nothing. */
const pick = new Int32Array(HIZ_TEST_VALUES)
const levelFor = (x0: number, y0: number, x1: number, y1: number, levels: number) =>
  hizTestRect(x0, y0, x1, y1, false, 1 << 30, 1 << 30, levels, pick) ? pick[0] : -1

/** Transcribes WGSL `hizCoarseLevel`. */
function coarseLevel(x0: number, y0: number, x1: number, y1: number, l: number, levels: number) {
  let c = l
  while (c + 1 < levels && !((x1 >> c) - (x0 >> c) < 2 && (y1 >> c) - (y0 >> c) < 2)) c++
  return c
}

type Min = (a: number, b: number) => number
/** WGSL leaves `min` with a NaN operand indeterminate: `Math.min` propagates the NaN, `minNum`
 *  returns the other operand. Under the first the verdicts are identical; under the second the
 *  coarse test may keep a box whose footprint holds a NaN that the footprint minimum rejects,
 *  never the reverse. A pyramid reduced from a depth texture holds no NaN. */
const minNum: Min = (a, b) => (a !== a ? b : b !== b ? a : Math.min(a, b))

/** The footprint read: the minimum of the footprint (`pyramidFar`). */
function footprintFar(p: PackedHiz, l: number, rect: number[], min: Min) {
  let far = Math.fround(1.0e30)
  for (let y = rect[1]; y <= rect[3]; y++)
    for (let x = rect[0]; x <= rect[2]; x++)
      far = min(far, p.data[p.offsets[l] + y * p.sizes[l][0] + x])
  return far
}

/** The per-level 2 × 2 reduction (`buildHiz`) again with `min`: the pyramid such a GPU builds. */
function reduceWith(p: PackedHiz, min: Min) {
  for (let l = 1; l < p.sizes.length; l++) {
    const [w, h] = p.sizes[l],
      [sw, sh] = p.sizes[l - 1]
    const at = (x: number, y: number) => p.data[p.offsets[l - 1] + y * sw + x]
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const x0 = 2 * x,
          y0 = 2 * y
        let far = at(x0, y0)
        if (x0 + 1 < sw) far = min(far, at(x0 + 1, y0))
        if (y0 + 1 < sh) {
          far = min(far, at(x0, y0 + 1))
          if (x0 + 1 < sw) far = min(far, at(x0 + 1, y0 + 1))
        }
        p.data[p.offsets[l] + y * w + x] = far
      }
  }
}

/** `texelsHide`, with its early exit. */
function texelsHide(p: PackedHiz, l: number, rect: number[], nearest: number) {
  const [x0, y0, x1, y1] = rect
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (!(nearest < p.data[p.offsets[l] + y * p.sizes[l][0] + x])) return false
  return true
}

/** One clipped rectangle judged by the footprint minimum and by the coarse test, as
 *  `hiddenByPyramid` does. */
function judge(p: PackedHiz, rect: number[], levels: number, nearest: number, min: Min = Math.min) {
  const [x0, y0, x1, y1] = rect
  const l = levelFor(x0, y0, x1, y1, levels)
  if (l < 0) return undefined
  const fine = rect.map((v) => v >> l)
  assert.ok(fine[2] + 1 - fine[0] <= KERNEL && fine[3] + 1 - fine[1] <= KERNEL)
  const before = nearest < footprintFar(p, l, fine, min)
  const c = coarseLevel(x0, y0, x1, y1, l, levels),
    shift = c - l
  const coarse = fine.map((v) => v >> shift)
  assert.deepEqual(
    coarse,
    rect.map((v) => v >> c),
    'the coarse footprint is the rectangle at c',
  )
  assert.ok(
    (coarse[2] - coarse[0] <= 1 && coarse[3] - coarse[1] <= 1) || c === levels - 1,
    'at most 2×2 texels, or the last mip',
  )
  const after = (shift > 0 && texelsHide(p, c, coarse, nearest)) || texelsHide(p, l, fine, nearest)
  return { before, after, shift }
}

const SPECIALS = [0, -0, 1, Infinity, -Infinity, Number.NaN, Math.fround(0.5), Math.fround(1e-30)]

function pyramid(rand: () => number, width: number, height: number, hostile: boolean) {
  // A few distinct depths so that ties between the box and the texels are frequent.
  const palette = Array.from({ length: 6 }, () => Math.fround(rand()))
  const pick = () =>
    hostile && rand() < 0.05
      ? SPECIALS[Math.floor(rand() * SPECIALS.length)]
      : palette[Math.floor(rand() * palette.length)]
  return packHizPyramid(Array.from({ length: height }, () => Array.from({ length: width }, pick)))
}

function sweep(seed: number, hostile: boolean, min: Min = Math.min) {
  const rand = lcgRandom(seed)
  let judged = 0,
    rejected = 0,
    coarse = 0
  for (let trial = 0; trial < 400; trial++) {
    const width = 1 + Math.floor(rand() * 90),
      height = 1 + Math.floor(rand() * 90)
    const p = pyramid(rand, width, height, hostile)
    if (min !== Math.min) reduceWith(p, min)
    // A mip table cut short (the camera's holds at most 16) leaves wide rectangles unjudged.
    const levels = rand() < 0.2 ? 1 + Math.floor(rand() * p.sizes.length) : p.sizes.length
    for (let box = 0; box < 40; box++) {
      const x0 = Math.floor(rand() * width),
        y0 = Math.floor(rand() * height)
      const x1 = x0 + Math.floor(rand() * (width - x0)),
        y1 = y0 + Math.floor(rand() * (height - y0))
      const nearest =
        hostile && rand() < 0.1
          ? SPECIALS[Math.floor(rand() * SPECIALS.length)]
          : Math.fround(p.data[Math.floor(rand() * p.data.length)] - (rand() - 0.5) * 0.1)
      const verdicts = judge(p, [x0, y0, x1, y1], levels, nearest, min)
      if (!verdicts) continue
      judged++
      if (verdicts.before) rejected++
      if (verdicts.shift > 0) coarse++
      const where = `seed ${seed}, [${x0},${y0},${x1},${y1}]`
      if (min === Math.min) assert.equal(verdicts.after, verdicts.before, where)
      else assert.ok(!verdicts.after || verdicts.before, `rejects what develop keeps: ${where}`)
    }
  }
  return { judged, rejected, coarse }
}

test('the coarse pre-test and early exit give the verdict of the whole-footprint minimum', () => {
  for (const seed of [1, 2, 3, 4]) {
    const { judged, rejected, coarse } = sweep(seed, false)
    // The sweep reaches both verdicts and the coarse path, else it proves nothing.
    assert.ok(rejected > 0 && rejected < judged && coarse > 0)
  }
})

test('same verdict with NaN, ±0 and ±Inf in the pyramid and as the box depth', () => {
  for (const seed of [11, 12, 13, 14]) sweep(seed, true)
})

test('where min drops NaN, the new test never rejects a box the old one keeps', () => {
  for (const seed of [21, 22, 23, 24]) sweep(seed, true, minNum)
})

test('edge cases: one texel, a kernel-wide footprint, a buried box, a box in front', () => {
  const one = packHizPyramid([[0.5]])
  for (const nearest of [0.25, 0.5, 0.75, -0, Number.NaN, -Infinity])
    assert.deepEqual(judge(one, [0, 0, 0, 0], 1, nearest), {
      before: nearest < 0.5,
      after: nearest < 0.5,
      shift: 0,
    })
  const wide = packHizPyramid(Array.from({ length: 64 }, () => new Array<number>(64).fill(0.5)))
  const full = [0, 0, 63, 63]
  const buried = judge(wide, full, wide.sizes.length, 0.25)
  assert.deepEqual(buried, { before: true, after: true, shift: 3 })
  assert.deepEqual(judge(wide, full, wide.sizes.length, 0.75), {
    before: false,
    after: false,
    shift: 3,
  })
  // The kernel-wide footprint at level 0 exactly.
  const edge = [0, 0, KERNEL - 1, KERNEL - 1]
  assert.equal(levelFor(edge[0], edge[1], edge[2], edge[3], wide.sizes.length), 0)
  assert.equal(judge(wide, edge, wide.sizes.length, 0.25)?.after, true)
  // No mip covers the rectangle: unjudged on both sides.
  assert.equal(judge(wide, full, 2, 0.25), undefined)
})

// The patches of a displaced surface are judged by the view as the cut judges a box
// (`patchSight`, `../../tessellation/sightWgsl.ts`): the frustum, the clip plane, the pixel centres its
// rectangle covers, then the pyramid — the previous image's in the main pass, which only hides, this
// image's in the post pass, which drops.
test('a patch is gone from the image, seen, or hidden by the pyramid of the pass that judges it', () => {
  const [f, aspect, near] = [1.7, 2, 0.1]
  // A reversed infinite perspective, the eye at the origin looking down −z.
  const viewProj = new Mat([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0])
  const uni = {
    viewProj,
    viewport: [64, 32],
    perspective: 1,
    clipRoute: 0,
    clipPlane: [0, 0, 0, 0],
  }
  const hizLevels = {
    count: [3, 0, 0, 0],
    level: [
      [0, 64, 32, 0],
      [0, 32, 16, 0],
      [0, 16, 8, 0],
    ],
  }
  const tu = {
    occlusion: OCCLUSION_NONE,
    depthMap: [near, 0],
    prevDepthMap: [near, 0],
    prevSize: [64, 32],
    prevViewProj: viewProj,
  }
  // The pyramid's farthest depth, everywhere: reversed, a box shows when its nearest is at least it.
  let farthest = 0
  const { patchSight } = shaderRun<{ patchSight(box: object, world: Mat): number }>(
    wgslBlock('patchSight', [PATCH_SIGHT_WGSL], ''),
    ['patchSight'],
    {
      ...{ uni, tu, hizLevels, FINITE_SENTINEL: 3.4e38 },
      hizCullFarthest: () => farthest,
      hizMip: (level: number) => [0, hizLevels.level[level]![1]],
    },
  )
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const at = (z: number, half = 0.5, x = 0) => ({
    lo: [x - half, -half, z - half],
    hi: [x + half, half, z + half],
  })
  // Gone: behind the eye, off to the side, covering no pixel centre.
  assert.deepEqual(
    [at(5), at(-5, 0.5, 40), at(-50, 1e-4)].map((box) => patchSight(box, identity)),
    [SIGHT_GONE, SIGHT_GONE, SIGHT_GONE],
  )
  assert.equal(patchSight(at(-5), identity), SIGHT_SEEN, 'in view, no pyramid asked')
  // The view's clip plane: a box wholly behind it is gone while the cut culls by it, one across it is not.
  Object.assign(uni, { clipRoute: 1, clipPlane: [0, 0, 1, 5.5] })
  assert.equal(patchSight(at(-3), identity), SIGHT_SEEN, 'in front of z = −5.5')
  assert.equal(patchSight(at(-5.2), identity), SIGHT_SEEN, 'across it')
  assert.equal(patchSight(at(-8), identity), SIGHT_GONE, 'behind it')
  uni.clipRoute = 0
  assert.equal(patchSight(at(-8), identity), SIGHT_SEEN, 'the cull off')
  // Under the pyramid of the post pass, then of the main pass: hidden where it hides, shown where it
  // does not — and a box that reaches the near plane is never hidden.
  for (const mode of [OCCLUSION_POST, OCCLUSION_MAIN]) {
    tu.occlusion = mode
    farthest = 10
    assert.equal(patchSight(at(-5), identity), SIGHT_HIDDEN, `hidden, mode ${mode}`)
    assert.equal(
      patchSight(at(-0.55, 0.5), identity),
      SIGHT_SEEN,
      `across the near plane, mode ${mode}`,
    )
    farthest = 0
    assert.equal(patchSight(at(-5), identity), SIGHT_SEEN, `shown, mode ${mode}`)
  }
  // The main pass tests the previous image's matrix: a previous view that saw the box off screen
  // hides nothing of it.
  tu.occlusion = OCCLUSION_MAIN
  farthest = 10
  tu.prevViewProj = new Mat([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, 1, 0, 0, near, 0])
  assert.equal(patchSight(at(-5), identity), SIGHT_SEEN, 'behind the eye of the previous image')
})
