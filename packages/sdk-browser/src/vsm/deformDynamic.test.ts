// A deformed caster invalidates the pages it draws only while its placement moves: a still one,
// turned static after VSM_STILL_FRAMES frames, would otherwise stale its static pages
// each frame it draws them, and draw them again every frame (S14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../texture/shaderRule.fixture.ts';
import { MOBILITY_CUTOUT, MOBILITY_MOVING } from '../gpu/shadow/mobilityBits.ts';
import { vsmRenderCandidatesWgsl, vsmRenderCullWgsl } from './renderCullWgsl.ts';
import { vsmTransmissionCandidatesWgsl } from './transmissionWgsl.ts';
import { vsmLayout } from './resources.ts';

const candidates = vsmRenderCandidatesWgsl(),
  { VSM_RENDER_CAND_DYNAMIC, VSM_RENDER_CAND_DEFORMING } = wgslConstants(candidates);
const { vsmRenderCandidateFlags } = shaderRun<{
  vsmRenderCandidateFlags: (word: number, deformOutput: number) => number;
}>(candidates, ['vsmRenderCandidateFlags'], { VSM_RENDER_CAND_DYNAMIC, VSM_RENDER_CAND_DEFORMING });
const { vsmRasterMarkBits } = shaderRun<{
  vsmRasterMarkBits: (staticLayer: boolean, staleAfter: boolean) => number;
}>(vsmRenderCullWgsl(vsmLayout({ fullMapCapacity: 1 }, 1 << 27)), ['vsmRasterMarkBits'], {});

/** The slices `pmFoldMarks` reads: dirty dynamic, dirty static, then the two
 *  invalidations. */
const DIRTY_STATIC = 1 << 1,
  STALE_DYNAMIC_MARK = 1 << 2,
  STALE_STATIC_MARK = 1 << 3;

/** What `vsmRenderCull` makes of a row's candidate flags in a cached view: its slice and the
 *  mark-page-dirty flags of every page it draws. */
function cull(word: number, deformOutput: number) {
  const flags = vsmRenderCandidateFlags(word, deformOutput),
    staticLayer = (flags & VSM_RENDER_CAND_DYNAMIC) === 0;
  const dirty = vsmRasterMarkBits(staticLayer, (flags & VSM_RENDER_CAND_DEFORMING) !== 0);
  return { staticLayer, dirty };
}

const DEFORMED = 0x80000001;

test('a deformed row of a still placement stays static and invalidates no page it draws', () => {
  const { staticLayer, dirty } = cull(MOBILITY_CUTOUT, DEFORMED);
  assert.equal(staticLayer, true);
  assert.equal(dirty & STALE_STATIC_MARK, 0, 'no STALE_STATIC_MARK: its static pages stay cached');
  assert.equal(dirty & STALE_DYNAMIC_MARK, 0);
  assert.equal(dirty, DIRTY_STATIC, 'what it draws still dirties the static page it wrote');
});

test('a deformed row of a moving placement is dynamic and invalidates its dynamic pages alone', () => {
  const { staticLayer, dirty } = cull(MOBILITY_MOVING, DEFORMED);
  assert.equal(staticLayer, false);
  assert.equal(dirty & STALE_DYNAMIC_MARK, STALE_DYNAMIC_MARK);
  assert.equal(dirty & STALE_STATIC_MARK, 0);
});

test('a row neither deformed nor moving is unchanged: static, no invalidation', () => {
  assert.deepEqual(cull(0, 0), { staticLayer: true, dirty: DIRTY_STATIC });
  assert.deepEqual(cull(MOBILITY_MOVING, 0), { staticLayer: false, dirty: 1 });
});

test('the coloured transmission sorts its candidates by the same rule', () => {
  const call = 'vsmRenderCandidateFlags(mobility[row],page.deformOutput)';
  for (const code of [candidates, vsmTransmissionCandidatesWgsl()]) {
    assert.ok(code.includes(call));
    assert.ok(!code.includes('flags|=VSM_RENDER_CAND_DEFORMING'), 'no second rule beside it');
  }
});
