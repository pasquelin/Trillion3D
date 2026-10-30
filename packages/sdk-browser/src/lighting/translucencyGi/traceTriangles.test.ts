// The cones' trace through the scene's triangles (`traceTrianglesWgsl.ts`): the program assembles, its bindings clear those of the cut's tables.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_GI_RULES } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'
import { TRANSLUCENCY_GI_FRAME } from './layout.ts'
import {
  traceGiTrianglesEntries,
  traceGiTrianglesProgram,
  traceGiTrianglesSceneEntries,
} from './traceTrianglesWgsl.ts'

const code = traceGiTrianglesProgram('rgba16float', WORD_LIGHT_FORMAT)

test('the trace through the triangles assembles', () => {
  assertProgramAssembles(code)
})

test('group 0 binds each binding once and the scene trace has a group of its own', () => {
  const bindings = traceGiTrianglesEntries('rgba16float', WORD_LIGHT_FORMAT).map((e) => e.binding)
  assert.equal(new Set(bindings).size, bindings.length)
  assert.ok(traceGiTrianglesSceneEntries().length > 0)
})

test('a cone is traced once: one that hits writes its light, one whose walk is whole and meets nothing the radiance cache’s', () => {
  assert.match(code, /if\(!hit\.hit&&stComplete\)\{\s*radiance=giFar\(d\);/)
  assert.ok(code.includes('stTraceAvoiding(giOrigin-view.display.yzw,d,0.0,giReach,u32(gi.rays.z))'))
  assert.equal(code.match(/textureStore\(coneLight,id/g)?.length, 1)
})

test('the cones are cast through the triangles by default, over the frame’s depth bias and nearest hit', () => {
  assert.equal(resolveSettings(TRANSLUCENCY_GI_RULES, {}).translucencyGiHardwareRayTracing, true)
  assert.ok(TRANSLUCENCY_GI_FRAME.at.rays !== undefined)
  assert.ok(code.includes('gi.rays.x,gi.rays.y'))
})

test('a hit that brings no light is a hit all the same: the cache is not read for it', () => {
  assert.ok(!code.includes('(!hit.frontFace&&!hit.twoSided)||hit.distance'))
  assert.ok(code.includes('if(hit.hit){radiance+=tracedHitLight('))
})
