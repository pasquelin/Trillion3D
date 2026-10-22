// Every shadowed light of a frame is projected in one pass: each pixel's depth, normal,
// flags and receiver are read once for all of them, where a pass per four lights read them again.
// A light's result depends on its own trace and the pixel's inputs only, and the tile's votes stay
// in uniform flow: the per-light work is the one four-light passes did.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../../../materials/texture/shaderRule.fixture.ts'
import { commandArgs } from '../../../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { vsmProjectionWgsl } from './projectionWgsl.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS, VSM_PROJECTION_VIEW_BYTES } from './projectionView.ts'
import { writeVsmProjectionFrame, type VsmProjectionLight } from './projectionPass.ts'
import { camera, sun } from './projectionScene.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { VSM_PROJECTION_HEADER_WORDS, VSM_PROJECTION_VIEW_WORD } from './projectionView.ts'
import { projectionKit } from './projectionKit.fixture.ts'
import {
  VSM_TRACE_KINDS_BOTH,
  VSM_TRACE_KINDS_LOCAL,
  VSM_TRACE_KINDS_SUN,
} from '../trace/traceWgsl.ts'

const CODE = vsmProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }))

test('one store a layer the tile holds a light of, under bounds the view gives: the votes stay in uniform flow', () => {
  // The bench's `// @cut` lines (`bench/dawn/passes/shaderCuts.ts`) are comments for it, not code.
  const entry = functionsOf(CODE, ['vsmProjection']).replace(/^\s*\/\/ @cut.*$/gm, ''),
    tile = functionsOf(CODE, ['vsmProjectTile'])
  // The mask's one store, a layer at a time, and its transmission's, a light at a time where the
  // frame holds translucent casters and a pane lies on its rays; the tile word's one, by the group's
  // first lane, its paned layers beside its stored ones.
  assert.equal(tile.match(/textureStore\(/g)?.length, 2)
  assert.match(
    tile,
    /if\(transmits&&any\(r\.through!=vec3f\(1\.0\)\)\)\{\s*textureStore\(vsmShadowThrough,pixel\.pos,k,vec4f\(r\.through,1\.0\)\);/,
  )
  assert.match(
    tile,
    /if\(pixel\.inRect\)\{textureStore\(vsmShadowMask,pixel\.pos,layer,vec4u\(word,0u,0u,0u\)\);\}/,
  )
  assert.equal(entry.match(/textureStore\(/g)?.length, 1)
  assert.match(
    entry,
    /textureStore\(vsmShadowMaskTiles,tile,vec4u\(vsmTileLayers\(tileRead\)\|\(paned<<16u\),0u,0u,0u\)\);/,
  )
  // The trace loops are bounded by the uniform count and skip on the uniform tile words alone.
  assert.match(tile, /for\(var layer=0u;layer<ceilDiv\(lightCount,4u\);layer\+\+\)\{/)
  assert.match(tile, /if\(held==0u\)\{continue;\}/)
  assert.match(tile, /for\(var lane=0u;lane<min\(4u,lightCount-first\);lane\+\+\)\{/)
  assert.equal(entry.match(/workgroupUniformLoad\(/g)?.length, 1)
  assert.match(entry, /vsmProjectTile\(pixel,lights,tileRead,lightCount\);/)
  assert.match(CODE, /lights:array<VsmProjectionLight,64>/)
  assert.match(CODE, /texture_storage_2d_array<r32uint,write>/)
  assert.match(CODE, /texture_storage_2d<r32uint,write>/)
  assert.equal(VSM_PROJECTION_VIEW_BYTES, 416 + 64 * 48)
})

test('nine lights: one vsm.projection pass, each light at its offset of the view', async () => {
  const { project, res, computePasses, upload: uploaded } = projectionKit()
  /** The constants of each pipeline the passes set since `from`. */
  const constants = (from = 0) =>
    computePasses
      .flatMap(({ commands }) => commandArgs(commands, 'setPipeline'))
      .slice(from)
      .map(([pipeline]) => (pipeline as GPUProgrammableStage).constants as Record<string, number>)
  const lights: VsmProjectionLight[] = Array.from({ length: 9 }, (_, k) => ({
    type: 'point',
    mapId: 8192 + 6 * k,
    direction: [0, -1, 0],
    position: [k, 2, 3],
    radius: 10,
  }))
  project(lights)
  assert.deepEqual(
    computePasses.map(({ label }) => label),
    ['vsm.projection'],
  )
  // The header and the nine records: the shader reads no record past the count.
  const upload = uploaded()
  assert.ok(upload)
  assert.equal(upload.size, 416 + 9 * 48, 'the view uniform, up to its last light')
  const u = new Uint32Array(upload.data.buffer, upload.data.byteOffset, upload.size! / 4)
  const f = new Float32Array(u.buffer, u.byteOffset, u.length)
  assert.equal(u[75], 9, 'the count')
  for (let k = 0; k < 9; k++) {
    const o = VSM_PROJECTION_HEADER_WORDS + 12 * k
    assert.equal(u[o + 9], 8192 + 6 * k, `light ${k}'s map`)
    assert.equal(f[o] + 0, k, `light ${k}'s position, the eye at the origin`)
  }
  // One module for every mix of lights, its trace specialised by the kinds the pass holds: one
  // light, a sun, both (`pipelineOfLights`).
  for (const [at, pass] of [lights.slice(0, 1), [sun], [sun, lights[0]]].entries())
    project(pass, { width: 8, height: 8, camera, frameIndex: 2 + at })
  assert.deepEqual(
    constants().map((c) => c.VSM_TRACE_KINDS),
    [VSM_TRACE_KINDS_LOCAL, VSM_TRACE_KINDS_LOCAL, VSM_TRACE_KINDS_SUN, VSM_TRACE_KINDS_BOTH],
  )
  const tooMany = Array.from({ length: VSM_PROJECTION_MAX_PASS_LIGHTS + 1 }, () => lights[0])
  assert.throws(() => writeVsmProjectionFrame(res, { lights: tooMany } as never))
})

test('the view’s rays and steps are written into its uniform: a sun’s and a local light’s, the defaults without any', () => {
  const { project, upload } = projectionKit()
  const traced = () => {
    const data = upload()!.data
    const at = VSM_PROJECTION_VIEW_WORD.traceRays
    return [...new Uint32Array(data.buffer, data.byteOffset + 4 * at, 4)]
  }
  project([sun])
  assert.deepEqual(traced(), [8, 8, 4, 4], 'the rays and steps of the defaults')
  const trace = {
    ...{ shadowRayCountDirectional: 4, shadowRayCountLocal: 0 },
    ...{ shadowSamplesPerRayDirectional: 2, shadowSamplesPerRayLocal: 7 },
  }
  project([sun], { trace })
  assert.deepEqual(traced(), [4, 0, 2, 7], 'a sun’s rays and steps, then a local light’s')
})

test('a trace takes the view’s rays and steps for its kind of light, one tap along the axis where its rays are 0', () => {
  const trace = functionsOf(CODE, ['vsmTraceLight'])
  for (const text of [
    'let rays=select(vsmView.traceRays.y,vsmView.traceRays.x,directional);',
    'var stepCount=i32(select(vsmView.traceRays.w,vsmView.traceRays.z,directional));',
    'let rayCap=max(rays,1u);',
    'if(single){s=0.0;}',
    'ditherWorld=select(VSM_TRACE_DITHER*pd.ditherTexels*texel,0.0,single);',
  ])
    assert.ok(trace.includes(text), text)
  assert.doesNotMatch(CODE, /VSM_TRACE_RAYS|VSM_TRACE_STEPS/, 'no constant of the shader')
})
