// The radiosity's probes and their integration: the fixed jitter index holds the probes' place and their rays' cells alike,
// and the integrated light is dithered only where it blends over the images.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { RADIOSITY_FILTER_ENTRIES, RADIOSITY_FILTER_WGSL } from './radiosityFilterWgsl.ts'
import { RADIOSITY_INTEGRATE_ENTRY, RADIOSITY_INTEGRATE_WGSL } from './radiosityIntegrateWgsl.ts'
import { RADIOSITY_TRACE_ENTRY, RADIOSITY_TRACE_WGSL } from './radiosityTraceWgsl.ts'

test('the fixed jitter index, where one is set, holds the probes and the cells of their rays: both draw at jitterIndex', () => {
  const T = RADIOSITY_TRACE_WGSL
  assertProgramAssembles(T, RADIOSITY_TRACE_ENTRY, 'the radiosity trace')
  assert.match(
    T,
    /fn jitterIndex\(temporal:u32\)->u32\{return select\(u32\(lp\.fixedJitter\),temporal,lp\.fixedJitter<0\);\}/,
  )
  assert.match(T, /let index=jitterIndex\(temporal\)%lp\.maxFrames;/)
  assert.match(T, /blueNoiseVec2\(probeCoord,jitterIndex\(temporal\)\)/)
})

test('the integrated light is dithered in its last place only where it blends with its history', () => {
  const I = RADIOSITY_INTEGRATE_WGSL
  assertProgramAssembles(I, RADIOSITY_INTEGRATE_ENTRY, 'the radiosity integration')
  const temporal = I.slice(I.lastIndexOf('if(lgFlag(FLAG_TEMPORAL)){'))
  const blend = temporal.slice(0, temporal.indexOf('\n }') + 3)
  assert.match(
    blend,
    /radiance=ditherLight\(mix\(history,radiance,1\.0\/\(1\.0\+framesBlended\)\),/,
  )
  assert.match(
    I,
    /textureStore\(indirectAtlas,vec2i\(texel\.atlas\),vec4u\(packLight\(radiance\),0u,0u,0u\)\);/,
  )
})

test('the filter and the integration look a neighbouring probe up by the one function, each keeping its own bounds', () => {
  assertProgramAssembles(RADIOSITY_FILTER_WGSL, RADIOSITY_FILTER_ENTRIES[0], 'the radiosity filter')
  for (const code of [RADIOSITY_FILTER_WGSL, RADIOSITY_INTEGRATE_WGSL]) {
    assert.equal(code.match(/fn cardProbeTexel\(/g)?.length, 1)
    assert.equal(code.match(/fn cardSizeInProbes\(/g)?.length, 1)
    assert.equal(code.match(/pagesAcross/g)?.length, 2)
  }
  assert.match(
    RADIOSITY_FILTER_WGSL,
    /let size=cardSizeInProbes\(page\);\n if\(any\(probeInCard<vec2i\(0\)\)\|\|any\(vec2u\(probeInCard\)>=size\)\)\{return;\}\n let at=cardProbeTexel\(page,size,vec2u\(probeInCard\)\);/,
  )
  assert.match(
    RADIOSITY_INTEGRATE_WGSL,
    /if\(any\(probe>=sizeInProbes\)\)\{return;\}\n let at=cardProbeTexel\(page,sizeInProbes,probe\);/,
  )
})

test('the probes’ occlusion is the reference’s: the uniform mapping of the line to the texel, eased over what the strength leaves of the distance', () => {
  const F = RADIOSITY_FILTER_WGSL
  const I = RADIOSITY_INTEGRATE_WGSL
  for (const code of [F, I]) {
    assert.match(code, /fn fastAtan2\(/)
    assert.match(code, /if\(distance2<=0\.01\)\{return 1\.0;\}/)
    assert.match(code, /let inProbe=toTested\*tangentBasis\(probe\.normal\)\/distance;/)
    assert.match(
      code,
      /vec2f\(\(fastAtan2\(-inProbe\.y,-inProbe\.x\)\+PI\)\/TWO_PI,inProbe\.z\),vec2f\(0\.0\),vec2f\(0\.99\)/,
    )
    assert.match(code, /\(vec2f\(probeAtlasCoord\(probe\.atlas\)\)\+uv\)\*f32\(lp\.hemisphere\)/)
    assert.match(
      code,
      /saturate\(\(traceHitDistance\(ray\)-distance\)\/max\(\(1\.0-lp\.probeOcclusionStrength\)\*distance,0\.0001\)\+1\.0\)/,
    )
  }
  // A distance no trace has written yet (0, the atlas as made) reads as a ray that met nothing: the probe is not hidden before its first
  // trace through the scene's triangles.
  for (const code of [F, I])
    assert.match(
      code,
      /let d=textureLoad\(probeHitDistance,vec2i\(ray\),0\)\.x;return select\(d,lp\.maxTrace,d<=0\.0\);/,
    )
  // The filter asks both ways, the integration the texel’s own place from the probe.
  assert.match(
    F,
    /w=min\(w,min\(probeVisibility\(texel\.position,at\),probeVisibility\(at\.position,texel\)\)\)/,
  )
  assert.match(I, /w=min\(w,probeVisibility\(texel\.position,at\)\)/)
})

test('a neighbour past the card’s far edge is no probe of it: the filter skips it, where the page index would run into the next row of pages', () => {
  // A card one page wide (128 texels, a probe every 4: 32 probes across). Its probe 31's right neighbour, 32, lies past the edge: without the
  // bound its page index (32·4/128 = 1, one page across) would be 1 + y·1, the first page of the next row, another part of the card.
  const looked: number[][] = []
  const { gatherNeighbour } = shaderRun<{
    gatherNeighbour: (texel: object, page: number, probe: number[], ray: number[], sum: { v: number[] }, weight: { v: number }) => void
  }>(RADIOSITY_FILTER_WGSL, ['gatherNeighbour'], {
    ...wgslConstants(RADIOSITY_FILTER_WGSL),
    lp: { spacing: 4, hemisphere: 4 },
    cardSizeInProbes: () => [32, 32],
    cardProbeTexel: (_page: number, _size: number[], probe: number[]) => (looked.push(probe), { inside: false, valid: false }),
  })
  const sum = { v: [0, 0, 0] },
    weight = { v: 0 }
  gatherNeighbour({}, 0, [31, 5], [0, 0], sum, weight)
  gatherNeighbour({}, 0, [32, 5], [0, 0], sum, weight)
  gatherNeighbour({}, 0, [5, 32], [0, 0], sum, weight)
  gatherNeighbour({}, 0, [-1, 5], [0, 0], sum, weight)
  assert.deepEqual(looked, [[31, 5]])
})
