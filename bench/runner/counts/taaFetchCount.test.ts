// The temporal pass's fetches a display pixel (`taaFetchCount.ts`): each pass's table holds as
// many fetch calls as its shipped program's text, so a pass that gains or loses a fetch breaks it;
// the analysis scales with the render texels a display pixel holds, the history update does not;
// a level without the flicker measure or the anti-aliaser leaves exactly their fetches out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TAA_PASS_FETCHES, countTaaFetches } from './taaFetchCount.ts'
import { wgslSource } from '../../../packages/math/src/wgsl/source.fixture.ts'
import { velocityShader } from '../../../packages/sdk-browser/src/post/taa/velocityWgsl.ts'
import { reprojectShader } from '../../../packages/sdk-browser/src/post/taa/reprojectWgsl.ts'
import { thinGeometryShader } from '../../../packages/sdk-browser/src/post/taa/thinGeometryWgsl.ts'
import { flickerShader } from '../../../packages/sdk-browser/src/post/taa/flickerWgsl.ts'
import {
  heldMeasureShader,
  rejectionShader,
} from '../../../packages/sdk-browser/src/post/taa/rejectionWgsl.ts'
import { spatialAntiAliasingShader } from '../../../packages/sdk-browser/src/post/taa/spatialAntiAliasingWgsl.ts'
import { taaResolveShader } from '../../../packages/sdk-browser/src/post/taa/resolveWgsl.ts'

/** The fetch calls a program's text holds: loads, filtered samples, gathers. */
const fetchCalls = (program: Parameters<typeof wgslSource>[0]) =>
  wgslSource(program).match(/\btexture(?:Load|Sample\w*|Gather\w*)\(/g)?.length ?? 0

test('each pass holds the fetch calls its table counts', () => {
  const P = TAA_PASS_FETCHES
  for (const [name, program, sites] of [
    ['velocity', velocityShader(), P.velocity.sites],
    ['reproject', reprojectShader(), P.reproject.sites],
    ['thin', thinGeometryShader(), P.thin.sites],
    ['flicker', flickerShader(), P.flicker.sites],
    ['held', heldMeasureShader(), P.held.sites],
    ['rejection', rejectionShader(), P.rejection.sites],
    ['antiAlias', spatialAntiAliasingShader(), P.antiAlias.sites],
    ['resolve', taaResolveShader(false), P.resolve.sites],
    ['resolve as-is', taaResolveShader(true), P.resolve.asIsSites],
  ] as const)
    assert.equal(fetchCalls(program), sites, name)
})

test('a tiled pass reads its span at every stage: the tile and its rings, over its texels', () => {
  const P = TAA_PASS_FETCHES
  // 16×16 texels: 26² slots of four, 20² of one, 16² of two.
  assert.equal(P.thin.perTexel, (26 * 26 * 4 + 20 * 20 + 16 * 16 * 2) / 256)
  // 16×8 texels: 34 × 26 slots of three, 26 × 18 of one, 20 × 12 of two, 16 × 8 of three.
  assert.equal(P.flicker.perTexel, (34 * 26 * 3 + 26 * 18 + 20 * 12 * 2 + 128 * 3) / 128)
  assert.equal(P.held.perTexel, (26 * 18 * 2 + 24 * 16) / 128)
  assert.equal(
    P.rejection.perTexel,
    (24 * 24 * 3 + 22 * 22 + 20 * 20 * 4 + 18 * 18 + 256 * 4) / 256,
  )
})

test('the analysis scales with the render texels a display pixel holds, the update does not', () => {
  const full = countTaaFetches(1),
    half = countTaaFetches(0.5)
  assert.equal(full.analysis, half.analysis)
  assert.equal(full.resolve, 19, 'four texels, five kernel colours, ten history taps')
  assert.equal(half.perDisplayPixel, half.analysis / 4 + 19)
  assert.equal(countTaaFetches(1, { kept: false }).resolve, 9, 'a refused pixel reads no history')
  assert.equal(countTaaFetches(1, { asIs: true }).resolve, 24, 'an as-is resolve adds five flags')
})

test('a level leaves out the flicker measure and the anti-aliaser it does not run', () => {
  const P = TAA_PASS_FETCHES
  const max = countTaaFetches(1).analysis
  assert.equal(countTaaFetches(1, { level: 'high' }).analysis, max)
  assert.equal(countTaaFetches(1, { level: 'medium' }).analysis, max - P.flicker.perTexel)
  assert.equal(
    countTaaFetches(1, { level: 'low' }).analysis,
    max - P.flicker.perTexel - P.antiAlias.perTexel,
  )
})
