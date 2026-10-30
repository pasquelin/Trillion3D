// The resolution of the translucent layers (`translucencyScale.ts`): the fraction a share and a basis name, the extent of the targets and what is
// drawn of them, the programs that make the smaller layers' depth and responsiveness (`translucencyDepth.ts`, `translucencyResponsive.ts`), and the
// view ratio the fragment entries scale their pixel back by (`sceneEntry.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  drawnSide,
  nearestDepthUpsample,
  runtimeTranslucencyExtent,
  runtimeTranslucencyFraction,
  translucencyFits,
} from './translucencyScale.ts'
import { SEPARATE_TRANSLUCENCY_RULES } from '../../../sdk-core/src/contracts/separateTranslucencyOptions.ts'
import { DOWNSAMPLE_DEPTH_WGSL } from './translucencyDepth.ts'
import { LAY_FEEDBACK_WGSL, UPSAMPLE_RESPONSIVE_WGSL } from './translucencyResponsive.ts'
import { translucencyBytes, type TranslucencyTargets } from './translucency.ts'
import { fitLayers } from './reducedView.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { DEPTH_FORMAT, FEEDBACK_FORMAT } from '../scene/targetFormats.ts'
import { RESPONSIVE_FORMAT } from './responsive.ts'
import { LATE_UPSAMPLE_WGSL, UPSAMPLE_DUAL_WGSL, UPSAMPLE_WGSL } from './translucencyComposeWgsl.ts'
import { BLEND_SHADER } from '../gpu/core/shaderTexts.fixture.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

test('the settings default to the reference: the full resolution, the render basis, the nearest depth upsample', () => {
  assert.equal(SEPARATE_TRANSLUCENCY_RULES.translucencyScreenPercentage.default, 100)
  assert.equal(SEPARATE_TRANSLUCENCY_RULES.translucencyScreenPercentageBasis.default, 0)
  assert.equal(SEPARATE_TRANSLUCENCY_RULES.translucencyUpsampleMode.default, 1)
})

/** A runtime that holds the two settings. */
const settings = (percentage: number, basis: number) =>
  ({
    context: { translucencyScreenPercentage: percentage, translucencyScreenPercentageBasis: basis },
  }) as never

test('a side is the image’s side times the fraction, cut to a whole number, one at the least, held to the targets', () => {
  const extent = (percentage: number, size: readonly [number, number]) =>
    runtimeTranslucencyExtent(settings(percentage, 0), size, size)
  assert.deepEqual(extent(50, [1921, 1081]), { scaled: true, width: 960, height: 540 })
  assert.deepEqual(extent(0, [1920, 1080]), { scaled: true, width: 1, height: 1 })
  assert.equal(drawnSide(1921, 0.5, 2000), 960)
  assert.equal(drawnSide(1920, 0.5, 900), 900, 'held to the targets')
})

test('the fraction is the share, divided by the share of the display drawn at with the display basis', () => {
  const fraction = (percentage: number, basis: number, drawn: number) =>
    runtimeTranslucencyFraction(settings(percentage, basis), [drawn, 1], [1920, 1080])
  assert.equal(fraction(50, 0, 960), 0.5)
  assert.equal(fraction(100, 0, 960), 1)
  assert.equal(fraction(0, 0, 960), 0)
  assert.equal(fraction(50, 1, 960), 1, 'half of the display, on a render at half')
  assert.equal(fraction(50, 1, 1920), 0.5)
})

test('the targets are the image’s own at a share of 100 whenever the rects agree, smaller below it, and follow the display with the display basis', () => {
  const render: readonly [number, number] = [1280, 720],
    display: readonly [number, number] = [1920, 1080]
  const extent = (percentage: number, basis: number, allocated = render, apart = false) =>
    runtimeTranslucencyExtent(settings(percentage, basis), allocated, display, apart)
  assert.deepEqual(extent(100, 0), { scaled: false, width: 1280, height: 720 })
  assert.deepEqual(extent(50, 0), { scaled: true, width: 640, height: 360 })
  assert.deepEqual(extent(50, 1), { scaled: true, width: 960, height: 540 })
  // The display basis scales only where the rects differ: at a share of 100 with the render targets the display's size, none of the smaller
  // layers' targets or programs exist.
  assert.deepEqual(extent(100, 1, display), { scaled: false, width: 1920, height: 1080 })
  assert.equal(extent(100, 1).scaled, true, 'smaller than the display')
  assert.equal(extent(50, 1, display).scaled, true)
  // Under dynamic resolution the render rect can drop below the display's: the display basis keeps the smaller targets even at 100.
  assert.deepEqual(extent(100, 1, display, true), { scaled: true, width: 1920, height: 1080 })
  assert.deepEqual(extent(100, 0, display, true), { scaled: false, width: 1920, height: 1080 })
})

test('made targets fit the frame’s extent, unscaled ones whatever its size', () => {
  const made = { active: true, reduced: {}, extent: [640, 360] as [number, number] }
  assert.ok(translucencyFits(made, { scaled: true, width: 640, height: 360 }))
  assert.ok(!translucencyFits(made, { scaled: true, width: 960, height: 540 }))
  assert.ok(!translucencyFits(made, { scaled: false, width: 1280, height: 720 }))
  assert.ok(
    !translucencyFits({ ...made, reduced: undefined }, { scaled: true, width: 640, height: 360 }),
  )
  assert.ok(
    translucencyFits(
      { ...made, active: false, reduced: undefined },
      { scaled: true, width: 1, height: 1 },
    ),
  )
  assert.ok(translucencyFits(undefined, { scaled: true, width: 1, height: 1 }))
})

test('the nearest depth neighbour is used at half the image’s size and a mode above 0 only', () => {
  assert.ok(nearestDepthUpsample(1, 0.5))
  assert.ok(!nearestDepthUpsample(0, 0.5))
  assert.ok(!nearestDepthUpsample(1, 0.25))
  assert.ok(!nearestDepthUpsample(1, 960 / 1921), 'an odd side is not a half')
})

test('the depth of the smaller layers is the scene’s texel under each of theirs, the first of its square', () => {
  const loaded: number[][] = []
  const { downsampleDepth } = shaderRun<{ downsampleDepth: (pixel: number[]) => number }>(
    DOWNSAMPLE_DEPTH_WGSL,
    ['downsampleDepth'],
    {
      // Source 8 × 6 over a destination of 4 × 3: a ratio of 2, the last texel (7, 5).
      span: [2, 2, 7, 5],
      source: {
        load: (at: number[]) => {
          loaded.push([...at])
          return at[0] / 100
        },
      },
    },
  )
  assert.equal(downsampleDepth([1.5, 2.5, 0, 1]), 0.02)
  assert.deepEqual(loaded.pop(), [2, 4], 'the texel (1, 2) times the ratio')
  downsampleDepth([3.5, 2.5, 0, 1])
  assert.deepEqual(loaded.pop(), [6, 4])
  assert.equal(downsampleDepth([4.5, 3.5, 0, 1]), 0.07, 'past the last texel, held to it')
  assert.deepEqual(loaded.pop(), [7, 5])
})

test('the marks of the smaller layers are laid where they mark, at the texel under the pixel', () => {
  const { upsampleResponsive } = shaderRun<{ upsampleResponsive: (pixel: number[]) => number }>(
    UPSAMPLE_RESPONSIVE_WGSL,
    ['upsampleResponsive'],
    {
      span: [0.5, 0.5, 3, 2],
      source: { load: (at: number[]) => [at[0] === 1 && at[1] === 1 ? 0.25 : 0, 0, 0, 0] },
      discard: () => undefined,
    },
  )
  assert.equal(upsampleResponsive([2.5, 2.5, 0, 1]), 0.25)
})

test('the smaller layers’ composition binds 64 bytes: the place, the extent and the projection’s depth terms', () => {
  for (const code of [UPSAMPLE_WGSL, UPSAMPLE_DUAL_WGSL, LATE_UPSAMPLE_WGSL])
    assert.match(
      wgslSource(code),
      /struct Upsample\{place:vec4f,extent:vec4f,depth:vec4f,radius:vec4f,\}/,
    )
})

test('the nearest depth neighbour holds its taps to the drawn texels, compares distances of the image’s projection, and loads the scene’s depth only then', () => {
  for (const code of [UPSAMPLE_WGSL, UPSAMPLE_DUAL_WGSL, LATE_UPSAMPLE_WGSL]) {
    const text = wgslSource(code)
    // Held to the last texel drawn, not to the texture's extent.
    assert.match(text, /let last=vec2i\(floor\(\w+\.place\.zw\*size\)\);/)
    assert.doesNotMatch(text, /textureDimensions\(lowDepth\)\)-vec2i\(1\)/)
    // The engine's depth to distance, perspective or orthographic, not the reciprocal of the depth.
    assert.match(text, /fn distanceAt\(depth:f32\)->f32\{return min\(sceneDepthOf\(depth\),/)
    assert.doesNotMatch(text, /1\.0\/max\(depth/)
    // The scene's depth is read after the early return of the bilinear read.
    assert.ok(text.indexOf('if(!nearest){return') < text.indexOf('textureLoad(fullDepth,texel,0)'))
  }
})

test('the late composition of smaller layers reads them at the render pixel under the image’s', () => {
  const text = wgslSource(LATE_UPSAMPLE_WGSL)
  assert.match(text, /let render=pixel\.xy\*lateView\.scale\.xy;/)
  assert.match(text, /tapsAt\(render,view\.extent\.z>=0\.5,fullDepth,vec2i\(render\)\)/)
})

test('the view ratio scales the fragment’s pixel back to the image’s, and leaves it at the ratio 1', () => {
  const run = (reduced: number[]) =>
    shaderRun<{ sceneVsOut: (raw: { position: number[] }) => { position: number[] } }>(
      BLEND_SHADER,
      ['sceneVsOut'],
      { uni: { reduced } },
    ).sceneVsOut({ position: [5.5, 3.5, 0.25, 1] }).position
  assert.deepEqual(run([1, 1]), [5.5, 3.5, 0.25, 1])
  assert.deepEqual(run([0.5, 0.5]), [11, 7, 0.25, 1])
})

test('the virtual-texture requests of the smaller layers are laid where a texel holds one', () => {
  const { layFeedback } = shaderRun<{ layFeedback: (pixel: number[]) => number }>(
    LAY_FEEDBACK_WGSL,
    ['layFeedback'],
    {
      span: [0.5, 0.5, 3, 2],
      source: { load: (at: number[]) => [at[0] === 1 && at[1] === 1 ? 7 : 0, 0, 0, 0] },
      discard: () => undefined,
    },
  )
  assert.equal(layFeedback([2.5, 2.5, 0, 1]), 7)
})

test('the smaller targets add the depth, the feedback and the marks of each set, and nothing at the image’s size', () => {
  const extra = (late: boolean) =>
    translucencyBytes(true, late, 8, 4, [16, 8], true) -
    translucencyBytes(true, late, 8, 4, [16, 8])
  const set = texelBytesOf(FEEDBACK_FORMAT) + texelBytesOf(RESPONSIVE_FORMAT)
  assert.equal(extra(false), 8 * 4 * (texelBytesOf(DEPTH_FORMAT) + set))
  assert.equal(extra(true), 8 * 4 * (texelBytesOf(DEPTH_FORMAT) + 2 * set))
  // The image of the late layers is counted only with the late set, whatever the targets.
  assert.equal(
    translucencyBytes(true, false, 8, 4, [16, 8], true),
    translucencyBytes(true, false, 8, 4, [99, 99], true),
  )
})

test('the layers are drawn apart only where they are drawn at a size other than the image’s', () => {
  const set = (extent: [number, number]) =>
    ({ extent, drawn: [0, 0], reduced: { apart: true } }) as unknown as TranslucencyTargets
  const apart = (target: TranslucencyTargets) => target.reduced!.apart
  const full = set([1920, 1080])
  fitLayers(full, [1920, 1080], 1)
  assert.equal(
    apart(full),
    false,
    'render = display at a share of 100 runs none of the reduced path',
  )
  const half = set([1920, 1080])
  fitLayers(half, [1920, 1080], 0.5)
  assert.deepEqual([apart(half), half.drawn], [true, [960, 540]])
  const below = set([1920, 1080])
  fitLayers(below, [1280, 720], 1)
  assert.equal(apart(below), false, 'drawn at the image’s own size')
  // Display basis, 100 %, dynamic resolution at 70 %: the layers are drawn at the display's size, a rect other than the image's.
  const dynamic = set([1920, 1080])
  fitLayers(
    dynamic,
    [1344, 756],
    runtimeTranslucencyFraction(settings(100, 1), [1344, 756], [1920, 1080]),
  )
  assert.deepEqual([apart(dynamic), dynamic.drawn], [true, [1920, 1080]])
})
