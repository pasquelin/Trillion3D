import assert from 'node:assert/strict'
import test from 'node:test'
import { shadowFinalWgsl, shadowInjestWgsl, shadowSpatialWgsl } from './shadowDenoiseSpatialWgsl.ts'
import { shadowTemporalWgsl } from './shadowDenoiseTemporalWgsl.ts'

const PROGRAMS = {
  injest: shadowInjestWgsl(),
  reconstruct: shadowSpatialWgsl('reconstruct'),
  web: shadowSpatialWgsl('web'),
  postFilter: shadowSpatialWgsl('postFilter'),
  temporal: shadowTemporalWgsl(),
  output: shadowFinalWgsl(false),
  sunOutput: shadowFinalWgsl(true),
}

test('every pass has its entry and names no reserved word', () => {
  const entries = {
    injest: 'shadowInjest',
    reconstruct: 'shadowReconstruct',
    web: 'shadowPreConvolve',
    postFilter: 'shadowPostFilter',
    temporal: 'shadowTemporal',
    output: 'shadowFinal',
    sunOutput: 'shadowFinal',
  } as const
  for (const [name, code] of Object.entries(PROGRAMS)) {
    assert.ok(code.includes(`fn ${entries[name as keyof typeof entries]}(`), name)
    assert.ok(!/\b(ref|from|meta|target|final|pass|filter|set|use)\s*[:=]/.test(code), name)
  }
})

test('the reconstruction takes the quad around its corner in descending rings and ends on the pixel', () => {
  const code = PROGRAMS.reconstruct
  assert.ok(code.includes('vec2f(id|vec2u(1u))'))
  assert.ok(code.includes('sdRingEnd(&rings'))
  assert.ok(code.includes('sdCenter('))
})

test('the pre-convolution is a web of three pairs about a jittered centre; the post filter caps the count at 1024', () => {
  assert.ok(PROGRAMS.web.includes('let pairs=3u*1u'))
  assert.ok(PROGRAMS.postFilter.includes('min(held,1024.0)'))
})

test('the accumulation clamps the history to 1.25 deviations and keeps a tenth of a sample', () => {
  assert.ok(PROGRAMS.temporal.includes('1.25*deviation'))
  assert.ok(PROGRAMS.temporal.includes('mean.x*0.1'))
})

test('the sun’s output takes the minimum into its layer of the mask', () => {
  assert.ok(PROGRAMS.sunOutput.includes('min(textureLoad(shadowOut,at,slot).x,visibility)'))
  assert.ok(!PROGRAMS.output.includes('read_write'))
})

test('every pass works over the rect of its light: the thread counts from its first texel, the taps stay in it, the history is read inside the rect it was written over', () => {
  for (const [name, code] of Object.entries(PROGRAMS)) {
    assert.ok(code.includes('sdPixelOf(gid.xy)'), name)
    assert.ok(code.includes('dnParams.rect.zw'), name)
  }
  assert.ok(PROGRAMS.reconstruct.includes('clamp(texel,vec2i(dnParams.rect.xy)'))
  assert.ok(PROGRAMS.reconstruct.includes('sdOutside(pos)'))
  assert.ok(PROGRAMS.temporal.includes('dnParams.lastRect.zw'))
})

test('a bilateral distance of a reference with no sample is the reference pixel’s own reach, and a last-image point behind its eye is not read', () => {
  assert.ok(PROGRAMS.temporal.includes('select(dist,sdAmend(ssPixelRadius(base.depth)),dist<0.0)'))
  assert.ok(PROGRAMS.temporal.includes('clip.w<=1e-8'))
  assert.ok(PROGRAMS.temporal.includes('near.flags==SD_SURFACE_LOST'))
})
