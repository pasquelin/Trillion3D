// The shading rejection's program: what its texels' words say, its network of operators over the
// 3×3 and the luma byte it writes, run in JavaScript from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import {
  REPROJECT_BITS,
  REPROJECTED_FLAGS_WGSL,
  REPROJECTED_WORD_WGSL,
  reprojectShader,
} from './reprojectWgsl.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { FULL_PRECISION } from './colorSpaceWgsl.ts'
import { flickerMeasureWgsl } from './flickerMeasureWgsl.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import { rejectionTypes } from './rejectionTypes.ts'
import { DISPLAY_STEP_ERROR_WGSL, FLICKER_GATES_WGSL } from './rejectionShared.ts'
import {
  LANES,
  overTile,
  operatorsOf,
  PROGRAM,
  texelAt,
  TILE,
  wrapped,
} from './rejectionNetwork.fixture.ts'
import { spatialAntiAliasingShader } from './spatialAntiAliasingWgsl.ts'

test('a texel whose material asks a restart is restarted as a disoccluded one is, and a pixel animation alone is not', () => {
  const { isRestarted, asksRestart } = shaderRun<{
    isRestarted: (word: number) => boolean
    asksRestart: (word: number) => boolean
  }>(rejectShadingShader('rgba8unorm', 'rgba16float'), ['isRestarted', 'asksRestart'], {})
  const { offScreen, disoccluded, restarts, animated, filled } = REPROJECT_BITS
  assert.deepEqual([offScreen, disoccluded, restarts].map(isRestarted), [true, true, true])
  assert.deepEqual([0, animated, filled].map(isRestarted), [false, false, false])
  assert.deepEqual([restarts, disoccluded, animated | restarts].map(asksRestart), [
    true,
    false,
    true,
  ])
  // Only an image that can resurrect a pixel sets the bit from the marks, and the shading rejection
  // (which decides the frame a pixel keeps since the merge was folded into it) never resurrects a
  // texel that asks it.
  assert.match(
    wgslSource(reprojectShader('rgba8unorm')),
    /select\(0u,16u,\(mark\.a&16u\)!=0u&&view\.resurrection\.x!=0\.0\)/,
  )
  assert.match(
    wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float')),
    /closer\[r\]=count\[r\]\.x>[^;]*&&!asksRestart\(word\[r\]\);/,
  )
})

test('the network gives each texel the operators of its 3×3, the neighbourhood wrapping around at the tile’s edge', () => {
  const h = [1, 2, 3],
    w = [5, 7, 11]
  const box = overTile((operators, column) => {
    const { lo, hi } = operators.minMax3x3(column)
    return column.map((_, r) => ({ lo: lo[r], hi: hi[r] }))
  })
  const sum = overTile((operators, column) => operators.weightedSum3x3(column, h, w))
  const variation = overTile((operators, column) => operators.totalVariation3x3(column))
  const median = overTile((operators, column) => operators.median3x3(column))
  const channels = [0, 1, 2, 3]
  /** Texel (x, y) against the 3×3 computed directly, its neighbours past the edge wrapped or not. */
  const check = (x: number, y: number, wrap: boolean) => {
    const at = `(${x}, ${y})`
    const around = [-1, 0, 1].flatMap((dy) =>
      [-1, 0, 1].map((dx) => ({
        dx,
        dy,
        texel: wrap ? texelAt(wrapped(x + dx), wrapped(y + dy)) : texelAt(x + dx, y + dy),
      })),
    )
    const values = (k: number) => around.map(({ texel }) => texel[k])
    near(
      box(x, y).lo,
      channels.map((k) => Math.min(...values(k))),
      `${at} lowest`,
      1e-12,
    )
    near(
      box(x, y).hi,
      channels.map((k) => Math.max(...values(k))),
      `${at} highest`,
      1e-12,
    )
    // The row weights `h` across, the column weights `w` down: a swapped tap row would show.
    near(
      sum(x, y),
      channels.map((k) =>
        around.reduce((total, { dx, dy, texel }) => total + h[dx + 1] * w[dy + 1] * texel[k], 0),
      ),
      `${at} weighted sum`,
    )
    near(
      variation(x, y),
      channels.map((k) => 1.125 * texelAt(x, y)[k] - 0.125 * values(k).reduce((a, b) => a + b, 0)),
      `${at} total variation`,
    )
    near(
      median(x, y),
      channels.map((k) => values(k).sort((a, b) => a - b)[4]),
      `${at} median`,
      1e-12,
    )
  }
  // The inner square, the tile less the three texels each side the workgroup only reads, has all of
  // its 3×3 inside the tile...
  for (let y = 3; y < TILE - 3; y++) for (let x = 3; x < TILE - 3; x++) check(x, y, false)
  // ...and one operator deep the whole tile is exact, the edge's neighbours those of the other side.
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) check(x, y, true)
})

test('a vote of the workgroup is true for every lane when any lane holds it, and false again when none does', () => {
  const network = Array.from({ length: TILE * TILE }, () => [0, 0, 0, 0])
  /** The vote after the lane at `holder` holds `x` and no other does: the lanes run in turn, the one
   *  at the tile's origin first, which clears the vote; then a lane that holds nothing reads it. */
  const vote = (holder: number | undefined) => {
    LANES.forEach(({ x, row }, lane) => operatorsOf(network, x, row).anyThread(lane === holder))
    return operatorsOf(network, 1, 0).anyThread(false)
  }
  assert.equal(vote(undefined), false, 'no lane holds it')
  assert.equal(vote(LANES.length - 1), true, 'the last lane does')
  assert.equal(vote(0), true, 'the lane that clears the vote does')
  assert.equal(vote(undefined), false, 'the vote of the image before is cleared')
})

test('the LDR luma a texel writes is the byte the anti-aliaser reads, the other bytes of its word kept', () => {
  // The write is a block of the rejection's entry, run as a function of its own.
  const write = /if\(view\.quality\.y>0\.0\)\{([^}]*)\}/.exec(PROGRAM)?.[1]
  assert.ok(write, 'the rejection writes the luma where the level runs the anti-aliaser')
  const words = [0, 0, 0]
  // `pack4x8unorm` as the specification has it: four unit floats rounded to bytes, the first low.
  const pack4x8unorm = (v: number[]) =>
    v.reduce(
      (word, x, i) => (word | (Math.round(Math.min(Math.max(x, 0), 1) * 255) << (8 * i))) >>> 0,
      0,
    )
  const { writeLuma } = shaderRun<{ writeLuma: (at: number, scene: number[]) => void }>(
    `${PROGRAM}\nfn writeLuma(at:u32,scene:vec3f){${write}}`,
    ['writeLuma'],
    { lumaOut: words, pack4x8unorm },
  )
  const { lumaAt } = shaderRun<{ lumaAt: (at: number) => number }>(
    spatialAntiAliasingShader(),
    ['lumaAt'],
    { luma: words },
  )
  const scenes = [
    [0.2, 0.3, 0.1],
    [1, 1, 1],
    [0, 0, 0],
    [4, 2, 0.5],
    [0.5, 0.25, 0.75],
    [10, 0, 0],
    [0.01, 0.02, 0.03],
    [3, 3, 3],
  ]
  // Eight texels, two words, written in an order that mixes them, then one written again.
  for (const at of [3, 0, 2, 1, 7, 4, 6, 5]) writeLuma(at, scenes[at])
  scenes[2] = [0.6, 0.6, 0.6]
  writeLuma(2, scenes[2])
  scenes.forEach((scene, at) => {
    // The Rec. 601 luma, in the display's range `l / (0.5 + l)`, as a byte.
    const luma = 0.299 * scene[0] + 0.587 * scene[1] + 0.114 * scene[2]
    assert.equal(lumaAt(at), Math.round(255 * (luma / (0.5 + luma))) / 255, `texel ${at}`)
  })
  assert.equal(lumaAt(8), 0, 'the next word is untouched')
})

test('the rejection widens its clamp by the blur of the lesser total variation in both modes; the mode is the flicker measure’s alone', () => {
  const text = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float'))
  // The shading rejection (the reference's `MeasureRejection`) takes the total variation term whatever the mode.
  assert.match(text, /clampError\[r\]=max\(max\(vec3f\(Q\),leastBlurred\[r\]\.rgb\),boxSize\[r\]\*/)
  assert.doesNotMatch(text, /select\(vec3f\(0\.0\),leastBlurred/)
  assert.match(text, /relaxing,flickerOn\);/)
  assert.equal(text.match(/,flickerOn\)/g)?.length, 2)
  // The mode is the uniform's, read once, by the flicker measure, which follows it with a branch the whole workgroup takes together
  // (the reference's `ComputeMoireError`).
  assert.equal(text.match(/view\.rates\.z/g)?.length, 1)
  assert.match(text, /fn shadingResponsive\(\)->bool\{return view\.rates\.z>0\.0;\}/)
  assert.equal(text.match(/if\(shadingResponsive\(\)\)\{/g)?.length, 1)
  assert.match(text, /let clampError=max\(max\(Q,variation\[r\]\),boxSize\*/)
})

test('the flicker measure lists what it reads that the rejection’s bindings do not declare: the view, the gates, the reprojection word’s flags, the display step error', () => {
  const measure = flickerMeasureWgsl(rejectionTypes(FULL_PRECISION))
  const listed = new Set(measure.deps.map((dep) => dep.name))
  for (const dep of [
    TAA_VIEW_WGSL,
    FLICKER_GATES_WGSL,
    REPROJECTED_FLAGS_WGSL,
    DISPLAY_STEP_ERROR_WGSL,
  ])
    assert.ok(listed.has(dep.name), dep.name)
  // It is handed the word, never reads the reprojection itself: no fetch of its own.
  assert.ok(!listed.has(REPROJECTED_WORD_WGSL.name))
  assert.doesNotMatch(measure.text, /textureLoad\(reprojected/)
  // The program holds the display step error once, for the rejection and the measure both.
  const text = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float'))
  assert.equal(text.match(/const Q=/g)?.length, 1)
})
