// The sun's far-shadow test is the reference's CPU subject gathering's alone (`TestPrimitiveFarCascadeConditions`):
// it reaches the subjects that are no cluster geometry, and every caster the engine draws is made of
// clusters (`casters/casterFeed.ts`). The shadow raster's candidates and cull carry no such test: the maps
// take every cluster caster, near or far, whatever a root's mark says, and the distance-field cascade
// takes none of them, whatever a mark says.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { MARK_BITS, SHADOWLESS_ROOT } from '../../visibility/shader/castingMark.ts'
import { DFSH_CULL_WGSL } from '../distanceField/shadow/cullWgsl.ts'
import { flagsOf } from '../distanceField/objectCasting.ts'
import { vsmRenderCandidatesWgsl } from './vsm/render/renderCandidatesWgsl.ts'
import { vsmRenderCullWgsl } from './vsm/render/renderCullWgsl.ts'
import { VSM_RENDER_PARAMS } from './vsm/render/renderParamsWgsl.ts'
import { SUNS_LAYOUT } from './vsm/layout.fixture.ts'

const WORLD = MARK_BITS.worldRoot
const BITS = [SHADOWLESS_ROOT, MARK_BITS.cacheStatic, MARK_BITS.hiddenShadow, WORLD]

test('the shadow raster takes every cluster caster whatever its mark, and the cascade takes none of them', () => {
  // No far-shadow test in the candidates, the cull or the parameters: nothing is left out by its distance.
  for (const code of [vsmRenderCandidatesWgsl(), vsmRenderCullWgsl(SUNS_LAYOUT)])
    assert.doesNotMatch(code, /vsmFarShadowSkipped|farDrop|farMeshes|farDepth|VSM_RENDER_CAND_FAR/)
  assert.deepEqual(
    Object.keys(VSM_RENDER_PARAMS.at).filter((field) => /^far/.test(field)),
    [],
  )
  const { dfshCasts } = shaderRun<{ dfshCasts: (flags: number) => boolean }>(
    DFSH_CULL_WGSL,
    ['dfshCasts'],
    wgslConstants(DFSH_CULL_WGSL),
  )
  let combinations = 0
  for (let combination = 0; combination < 1 << BITS.length; combination++) {
    const mark = BITS.reduce((bits, bit, k) => bits | ((combination >> k) & 1 ? bit : 0), 0)
    // The cascade: the placement is made of clusters, whatever its mark, and is left out.
    assert.equal(dfshCasts(flagsOf(true, false, false, mark)), false, `cascade, mark ${mark}`)
    combinations++
  }
  assert.equal(combinations, 16)
})
