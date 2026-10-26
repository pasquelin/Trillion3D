// A deformed caster invalidates the pages it draws only while its placement moves: a still one,
// turned static after `shadowCacheFramesStaticThreshold` frames, would otherwise stale its static pages
// each frame it draws them, and draw them again every frame (S14). A placement says it deforms by
// a bit of its word (`MOBILITY_DEFORMS`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { MOBILITY_DEFORMS, MOBILITY_MOVING } from '../mobilityBits.ts'
import { vsmRenderBinWgsl } from './render/renderBinWgsl.ts'
import { vsmRenderCandidatesWgsl } from './render/renderCandidatesWgsl.ts'
import { vsmLayout } from './layout.ts'

const candidates = vsmRenderCandidatesWgsl(),
  { VSM_RENDER_CAND_DYNAMIC, VSM_RENDER_CAND_DEFORMING } = wgslConstants(candidates)
const { vsmRenderCandidateFlags } = shaderRun<{
  vsmRenderCandidateFlags: (word: number) => number
}>(candidates, ['vsmRenderCandidateFlags'], { VSM_RENDER_CAND_DYNAMIC, VSM_RENDER_CAND_DEFORMING })
const { vsmRasterMarkBits } = shaderRun<{
  vsmRasterMarkBits: (...a: boolean[]) => number
}>(vsmRenderBinWgsl(vsmLayout({ fullMapCapacity: 1 })), ['vsmRasterMarkBits'], {})

/** The slices `vsmFoldRasterMarks` reads: dirty dynamic, dirty static, then the two
 *  invalidations. */
const DIRTY_STATIC = 1 << 1,
  STALE_DYNAMIC_MARK = 1 << 2,
  STALE_STATIC_MARK = 1 << 3

/** What `vsmRenderCull` makes of a caster's candidate flags in a cached view: its slice and the
 *  mark-page-dirty flags of every page it draws. */
function cull(word: number) {
  const flags = vsmRenderCandidateFlags(word),
    staticLayer = (flags & VSM_RENDER_CAND_DYNAMIC) === 0
  const dirty = vsmRasterMarkBits(
    staticLayer,
    (flags & VSM_RENDER_CAND_DEFORMING) !== 0,
    false,
    false,
  )
  return { staticLayer, dirty }
}

test('a deformed caster of a still placement is dynamic and invalidates its dynamic pages alone', () => {
  const { staticLayer, dirty } = cull(MOBILITY_DEFORMS)
  assert.equal(staticLayer, false)
  assert.equal(dirty & STALE_DYNAMIC_MARK, STALE_DYNAMIC_MARK)
  assert.equal(dirty & STALE_STATIC_MARK, 0, 'its static pages stay cached')
})

test('a deformed caster of a moving placement is dynamic and invalidates its dynamic pages alone', () => {
  const { staticLayer, dirty } = cull(MOBILITY_MOVING | MOBILITY_DEFORMS)
  assert.equal(staticLayer, false)
  assert.equal(dirty & STALE_DYNAMIC_MARK, STALE_DYNAMIC_MARK)
  assert.equal(dirty & STALE_STATIC_MARK, 0)
})

test('a caster neither deformed nor moving is unchanged: static, no invalidation', () => {
  assert.deepEqual(cull(0), { staticLayer: true, dirty: DIRTY_STATIC })
  assert.deepEqual(cull(MOBILITY_MOVING), { staticLayer: false, dirty: 1 })
})

test('an offset allowed where nothing invalidates marks the page; a level of detail behind adds its own mark', () => {
  const OFFSET = 16,
    LOD_BEHIND = 32
  assert.equal(vsmRasterMarkBits(false, false, true, false), 1 | OFFSET)
  assert.equal(
    vsmRasterMarkBits(true, true, true, false) & OFFSET,
    0,
    'invalidating: the stale bit',
  )
  assert.equal(vsmRasterMarkBits(true, false, false, true), 2 | LOD_BEHIND)
})
