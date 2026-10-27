// The temporal pass's fetches a display pixel (`taaFetchCount.ts`): each pass's table holds as
// many fetch calls as its shipped program's text, so a pass that gains or loses a fetch breaks it;
// the analysis scales with the render texels a display pixel holds, the history update with the
// history pixels it holds; a level without the flicker measure, the anti-aliaser, the resurrection
// or the field leaves exactly their fetches out, the thin geometry detection and the mask reads it
// feeds are counted only where the setting asks. The held measure, the two rejections, the merge,
// the resurrected guide and field are one shading rejection since they run in one workgroup
// network: their rows are its row, and so is the flicker measure, the first stage of its entry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TAA_PASS_FETCHES, countTaaFetches } from './taaFetchCount.ts'
import { wgslSource } from '../../../packages/math/src/wgsl/source.fixture.ts'
import { velocityShader } from '../../../packages/sdk-browser/src/post/taa/nearestVelocityWgsl.ts'
import { reprojectShader } from '../../../packages/sdk-browser/src/post/taa/reprojectWgsl.ts'
import { thinGeometryShader } from '../../../packages/sdk-browser/src/post/taa/thinGeometryWgsl.ts'
import { FULL_PRECISION } from '../../../packages/sdk-browser/src/post/taa/colorSpaceWgsl.ts'
import { flickerMeasureWgsl } from '../../../packages/sdk-browser/src/post/taa/flickerMeasureWgsl.ts'
import { rejectShadingShader } from '../../../packages/sdk-browser/src/post/taa/rejectionWgsl.ts'
import { rejectionTypes } from '../../../packages/sdk-browser/src/post/taa/rejectionTypes.ts'
import { resolveHistoryShader } from '../../../packages/sdk-browser/src/post/taa/historyResolveWgsl.ts'
import { spatialAntiAliasingShader } from '../../../packages/sdk-browser/src/post/taa/spatialAntiAliasingWgsl.ts'
import { taaResolveShader } from '../../../packages/sdk-browser/src/post/taa/resolveWgsl.ts'

/** The fetch calls a program's text holds: loads, filtered samples, gathers. */
const fetchCalls = (program: Parameters<typeof wgslSource>[0]) =>
  wgslSource(program).match(/\btexture(?:Load|Sample\w*|Gather\w*)\(/g)?.length ?? 0

test('each pass holds the fetch calls its table counts', () => {
  const P = TAA_PASS_FETCHES
  for (const [name, program, sites] of [
    ['velocity', velocityShader(), P.velocity.sites],
    ['reproject', reprojectShader('rgba8unorm'), P.reproject.sites],
    ['thin', thinGeometryShader(), P.thin.sites],
    ['reject', rejectShadingShader('rgba8unorm', 'rgba16float'), P.reject.sites],
    ['antiAlias', spatialAntiAliasingShader(), P.antiAlias.sites],
    // One update: the as-is pixels are composed after the temporal pass, no update reads a flag.
    ['update', taaResolveShader(), P.update.sites],
    ['resolve history', resolveHistoryShader('rg11b10ufloat'), P.resolveHistory.sites],
  ] as const)
    assert.equal(fetchCalls(program), sites, name)
})

test('a tiled pass reads its span at every stage: the tile and its rings, over its texels', () => {
  const P = TAA_PASS_FETCHES
  // 16×16 texels: 26² slots of four, 20² of one, 16² of one (the translucency's share, which read
  // the colour and the translucency target on the tile, is the weight relaxation's pass now).
  assert.equal(P.thin.perTexel, (26 * 26 * 4 + 20 * 20 + 16 * 16) / 256)
  // The shading rejection reads each texel of its 32×32 tile once and writes the inner 26×26.
  assert.equal(P.reject.perTexel, (4 * 32 * 32) / (26 * 26))
  // The flicker measure, the first stage of its entry, takes the word, the colour and the
  // translucency from the rejection's loads and reads of each texel of the tile once more the
  // flicker luma measured before the translucency, its history and the marks.
  const flickerFetches = fetchCalls(flickerMeasureWgsl(rejectionTypes(FULL_PRECISION)))
  assert.equal(flickerFetches, 3)
  assert.equal(P.reject.flicker, (flickerFetches * 32 * 32) / (26 * 26))
})

test('the analysis scales with the render texels a display pixel holds, the update with the history pixels', () => {
  const full = countTaaFetches(1),
    half = countTaaFetches(0.5)
  assert.equal(full.analysis, half.analysis)
  // The finest level: a history of four pixels a display pixel, each reading its vector, rejection
  // and anti-aliaser's offset, the field's three and ten history taps (the five kernel colours are
  // words of the scene colour's buffer since it left the textures), then the resolve's sixteen
  // colours (no share since the as-is pixels are composed after the temporal pass).
  assert.equal(full.resolve, (3 + 3 + 10) * 4 + 16)
  assert.equal(half.perDisplayPixel, half.analysis / 4 + full.resolve)
  // A level at the display's size resolves nothing, and without the field reads none of its words.
  assert.equal(countTaaFetches(1, { level: 'medium' }).resolve, 13, 'three, ten taps')
  assert.equal(countTaaFetches(1, { kept: false }).resolve, (3 + 3) * 4 + 16)
  assert.equal(
    countTaaFetches(1, { level: 'low', kept: false }).resolve,
    3,
    'a refused pixel reads no history',
  )
})

test('the thin geometry detection is counted where it runs', () => {
  const P = TAA_PASS_FETCHES
  const flat = countTaaFetches(1).analysis
  // On: the coverage measured before the translucency, the detection, its weight relaxation, and
  // the mask once a texel of the shading rejection's tile, which the flicker measure shares.
  assert.ok(
    Math.abs(
      countTaaFetches(1, { thin: true }).analysis -
        (flat +
          P.measure.coverage +
          P.thin.perTexel +
          P.relaxation.perTexel +
          1 * ((32 * 32) / (26 * 26))),
    ) < 1e-9,
  )
})

test('a level leaves out what it does not run', () => {
  const P = TAA_PASS_FETCHES
  const max = countTaaFetches(1).analysis
  assert.equal(countTaaFetches(1, { level: 'high' }).analysis, max)
  const medium = countTaaFetches(1, { level: 'medium' }).analysis
  // To the last bits: the shading rejection's rows are shares of its tile (32² read, 26² written).
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9)
  // Without the flicker measure, nor its luma measured before the translucency.
  near(medium, max - P.reject.flicker - P.measure.luma - P.velocity.field)
  near(
    countTaaFetches(1, { level: 'low' }).analysis,
    medium - P.antiAlias.perTexel - P.guide.perTexel - P.reject.resurrection,
  )
})
