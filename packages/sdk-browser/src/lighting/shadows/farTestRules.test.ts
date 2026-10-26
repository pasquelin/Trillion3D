// The sun's far-shadow test is one rule held in four places: the shadow raster's caster flags and the
// distance-field cascade's object flags, each built from a root's mark in TypeScript and read by a
// shader. A mesh reached is left out of the shadow maps past a sun's edge and traced by the cascade;
// one not reached is drawn by the maps at any distance and left out of the cascade: if they
// disagreed a mesh would be shadowed twice, or not at all. Every combination of the mark's casting
// bits and the world's own, under each rule of the view, goes through both shaders, and each meets
// the one function (`farTestedOf`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import {
  FAR_SHADOW_ROOT,
  farTestedOf,
  MARK_BITS,
  SHADOWLESS_ROOT,
} from '../../visibility/shader/castingMark.ts'
import { DFSH_CULL_WGSL } from '../distanceField/shadow/cullWgsl.ts'
import { DFSH_FLAG } from '../distanceField/shadow/layout.ts'
import { flagsOf } from '../distanceField/objectCasting.ts'
import { castFlagsOf } from './casters/castFlags.ts'
import { vsmRenderCandidatesWgsl } from './vsm/render/renderCandidatesWgsl.ts'

const WORLD = MARK_BITS.worldRoot
const BITS = [SHADOWLESS_ROOT, FAR_SHADOW_ROOT, MARK_BITS.farTest, MARK_BITS.farSkip, WORLD]

test('the shadow raster and the cascade reach a mesh by one rule, for every mark and each rule of the view', () => {
  const candidates = vsmRenderCandidatesWgsl()
  const consts = wgslConstants(candidates)
  const worldPlaced = (placement: number) => placement === 7
  const raster = (farMeshes: number) =>
    shaderRun<{ vsmRenderFarFlags: (word: number, placement: number) => number }>(
      candidates,
      ['vsmRenderFarFlags'],
      { ...consts, worldPlaced, params: { farMeshes } },
    ).vsmRenderFarFlags
  const cascade = (farMeshes: number) =>
    shaderRun<{ dfshCasts: (flags: number) => boolean }>(DFSH_CULL_WGSL, ['dfshCasts'], {
      ...wgslConstants(DFSH_CULL_WGSL),
      dfsh: { counts: [0, 0, 0, farMeshes ? DFSH_FLAG.farMeshes : 0] },
    }).dfshCasts
  let combinations = 0
  for (const farMeshes of [0, 1]) {
    const mapsTest = raster(farMeshes),
      cascadeCasts = cascade(farMeshes)
    for (let combination = 0; combination < 1 << BITS.length; combination++) {
      const mark = BITS.reduce((bits, bit, k) => bits | ((combination >> k) & 1 ? bit : 0), 0)
      const world = (mark & WORLD) !== 0
      const reached = farTestedOf(mark, farMeshes === 1)
      // The raster: its row's word is built from the host root's mark, which has not the world's
      // bit (the packing adds it); the world's rows are told apart by their placement.
      const word = castFlagsOf({ mark: mark & ~WORLD })
      const tested = (mapsTest(word, world ? 7 : 3) & consts.VSM_RENDER_CAND_FAR_TESTED) !== 0
      assert.equal(tested, reached, `raster, mark ${mark}, every mesh ${farMeshes}`)
      // The cascade: the stand-in of a world placement and a mesh's placement carry it in the mark.
      const shadowed = !(mark & SHADOWLESS_ROOT) && !(mark & FAR_SHADOW_ROOT) && reached
      assert.equal(
        cascadeCasts(flagsOf(true, false, mark)),
        shadowed,
        `cascade, mark ${mark}, every mesh ${farMeshes}`,
      )
      combinations++
    }
  }
  assert.equal(combinations, 64)
})

test('the rule: reached on its own account or by the view, never when the mark says never', () => {
  assert.equal(farTestedOf(0, false), false, 'a mesh drawn as itself, left to the view')
  assert.equal(farTestedOf(0, true), true, 'every mesh, when the view says so')
  assert.equal(farTestedOf(MARK_BITS.farTest, false), true)
  assert.equal(farTestedOf(WORLD, false), true, 'the world’s merged shells')
  assert.equal(
    farTestedOf(MARK_BITS.farSkip | MARK_BITS.farTest | WORLD, true),
    false,
    'never wins',
  )
})
