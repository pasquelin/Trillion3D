// The shadow maps' chain of patches: the seeding judges a triangle by the map's view and lists the small ones at once, the map's view
// scales its factors by the shadows' level of detail, and the uniform carries that scale.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../../../materials/texture/shaderRule.fixture.ts'
import { TESS_UNIFORM } from '../../../../visibility/tessellation/uniform.ts'
import { writtenUniform } from '../../../../visibility/tessellation/uniform.fixture.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'
import { vsmTessSource } from './shadowKernelsWgsl.ts'
import { splitSource } from '../../../../visibility/tessellation/splitWgsl.ts'
import { seedSource } from '../../../../visibility/tessellation/seedWgsl.ts'
import { VSM_TESS_VIEW_WGSL } from './shadowViewWgsl.ts'
import { vsmPatchSightWgsl } from './shadowSightWgsl.ts'
import { shadowLodScale, shadowSelectionPixelError } from '../frame/shadowLodScale.ts'
import { wgslModule } from '../../../../../../math/src/wgsl/assemble.ts'

test('the seeding lists a triangle that asks for no more than the immediate limit at once, on the window and in sight, and queues any other whole', () => {
  const source = vsmTessSource(SUNS_LAYOUT)
  const seed = functionsOf(source, ['vsmTessSeed'])
  // The reach of the displacement is worked out once for the record, and the factors of each triangle use it.
  // What the record gives every patch (its view's matrices and window, its sight) is worked out once for it too, before the triangles.
  assert.match(
    seed,
    /let far=farDepth\(rec,worldScale\(page\.world\),view\);\s*let patchRecord=vsmPatchRecordOf\(drawn\.raw,record\);\s*let sight=vsmPatchSightOf\(drawn\.raw,record\);\s*let triangles=/,
  )
  assert.match(seed, /let f=cornerFactors\(page\.world,shape\.corner,view,far\);/)
  assert.match(
    seed,
    /if\(!seededWhole\(f\)\)\{\s*queuePatch\(piece\);\s*\}else if\(vsmPatchLive\(piece,shape,page,patchRecord,sight\)\)\{\s*settleFactored\(piece,shape,f,vsmRecordStatic\(record\)\);/,
  )
  // The window and the sight are judged by one function the split uses too: off the window a patch is gone, hidden it is kept for the post pass.
  const live = functionsOf(source, ['vsmPatchLive'])
  assert.match(live, /if\(!vsmTessOnWindow\(placed,rec\)\)\{return false;\}/)
  assert.match(
    live,
    /if\(vsmPatchHidden\(placed,rec,sight\)\)\{occludePatch\(piece\);return false;\}/,
  )
  const split = functionsOf(source, ['vsmTessSplit'])
  assert.match(
    split,
    /if\(vsmPatchLive\(piece,shape,page,vsmPatchRecordOf\(drawn\.raw,record\),vsmPatchSightOf\(drawn\.raw,record\)\)\)\{\s*settlePatch\(piece,page,drawn\.rec,shape,drawn\.view,vsmRecordStatic\(record\)\);/,
  )
})

test('a patch the pyramid hides is kept by the main pass alone, in the region of the tess buffer, and taken up again by the post pass’s resume', () => {
  const seed = vsmTessSource(SUNS_LAYOUT)
  const keep = functionsOf(seed, ['occludePatch'])
  assert.match(keep, /if\(tu\.occlusion!=1u\)\{return;\}/, 'the post pass drops what it hides')
  assert.match(keep, /atomicAdd\(&tess\[tu\.args\+5u\],1u\)/)
  assert.match(keep, /storePatch\(tu\.occludedAt\+slot\*4u,p\)/)
  // The resume queues each patch the main pass kept, as the cut's resume does.
  const resume = functionsOf(seed, ['vsmTessResume'])
  assert.match(resume, /min\(tw\(tu\.mainArgs\+5u\),tu\.maxOccluded\)/)
  assert.match(resume, /queuePatch\(loadPatch\(tu\.occludedAt\+slot\*4u\)\)/)
  // The cut keeps and resumes by the same functions over its own buffer.
  const cut = splitSource()
  const imageKeep = functionsOf(cut, ['occludePatch'])
  assert.match(imageKeep, /if\(tu\.occlusion!=1u\)\{return;\}/)
  assert.match(imageKeep, /atomicAdd\(&tess\[tu\.args\+5u\],1u\)/)
  assert.match(imageKeep, /occluded\[at\]=p\.x/)
  assert.match(
    functionsOf(seedSource(), ['tessResume']),
    /min\(tw\(tu\.mainArgs\+5u\),tu\.maxOccluded\)/,
  )
})

test('the sight of a patch is the render cull’s own test of a caster: the previous frame’s pyramid for the main pass, this frame’s for the post pass', () => {
  const module = wgslModule(vsmPatchSightWgsl(false))
  // The record's part, worked out once for it: the mip, the layer, the previous view tested only by the main pass, and whether a pyramid is tested at all.
  const of = functionsOf(module, ['vsmPatchSightOf'])
  assert.match(of, /sight\.tests=tu\.occlusion!=0u;/, 'no pyramid, nothing tested')
  assert.match(
    of,
    /sight\.tests=vsmPrevViewHolds\(sight\.pd,sight\.mip\);/,
    'no previous view to test against, no test',
  )
  const sight = functionsOf(module, ['vsmPatchHidden'])
  assert.match(sight, /if\(!sight\.tests\)\{return false;\}/)
  assert.match(
    sight,
    /return vsmHiddenBefore\(sight\.pd,before,sight\.mip,sight\.levelTexels,sight\.staticLayer\);/,
  )
  assert.match(sight, /return vsmHiddenNow\(sight\.h,sight\.mip,placed\.cull,sight\.levelTexels,/)
})

test('the patches’ program binds at most the eight storage buffers any device holds, and the occlusion’s textures in group three', () => {
  const source = vsmTessSource(SUNS_LAYOUT)
  assert.ok((source.match(/var<storage/g) ?? []).length <= 8)
  assert.match(source, /@group\(3\) @binding\(0\) var occlusionPyramid/)
  assert.doesNotMatch(source, /@group\(2\) @binding\(0\) var occlusionPyramid/)
  assert.ok(source.includes('fn vsmTessResume('))
})

test('the map’s view scales its pixels per unit by the shadows’ level of detail, which is two to the minus the bias times the streaming quality', () => {
  assert.match(wgslModule(VSM_TESS_VIEW_WGSL), /lens\.focal\*tu\.edgesPerPixel\*tu\.lodScale/)
  // A runtime by the type the functions take; each call a runtime of its own, so that the scale worked out once for an image (`run.frame`) is its own.
  const rt = (bias: number, quality: number): Parameters<typeof shadowSelectionPixelError>[0] => ({
    context: { shadowGeometryLodBias: bias },
    services: { residency: { qualityScale: quality } },
    run: { frame: 1, gate: { pixelError: 2 } },
  })
  assert.equal(shadowLodScale(rt(1, 1)), 0.5, 'the default bias halves the factors')
  assert.equal(shadowLodScale(rt(0, 1)), 1)
  assert.equal(shadowLodScale(rt(2, 0.5)), 0.125)
  // A quality scale falls by a few percent an update: it keeps its step until it is nearer the next one, never drops to the coarser at the first move.
  assert.equal(shadowLodScale(rt(0, 0.97)), 1)
  assert.equal(shadowLodScale(rt(0, 0.8)), 2 ** -0.5)
  // The casters' clusters are judged by the image's tolerance over the same scale.
  assert.equal(shadowSelectionPixelError(rt(2, 0.5)), 2 / shadowLodScale(rt(2, 0.5)))
})

test('the uniform carries the shadow chain’s scale', () => {
  const { floats } = writtenUniform({ projection: 0, height: 0, threshold: 1, lodScale: 0.5 })
  assert.equal(floats[TESS_UNIFORM.at.lodScale], 0.5)
})
