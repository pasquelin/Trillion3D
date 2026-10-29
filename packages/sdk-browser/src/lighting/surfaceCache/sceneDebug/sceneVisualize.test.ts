import assert from 'node:assert/strict'
import test from 'node:test'
import { EYE_MARK_SHADER } from './eyeMarker.ts'
import { sceneVisualizeWgsl } from './sceneVisualizeWgsl.ts'

test('the scene view marches the camera ray through the field, reads the cache at the hit and the sky past it', () => {
  const code = sceneVisualizeWgsl('rgba16float')
  assert.match(
    code,
    /let marched=gdfTraceRay\(start,d,scene\.trace\.x,reach,mix\(0\.8,1\.0,noise\),false,false,/,
  )
  assert.match(code, /scGlobalHit\(start,d,marched,spread,false,-1\.0,/)
  assert.match(code, /else\{lighting=skyProbeRadiance\(d\);\}/)
  assert.match(code, /@fragment fn sceneVisualizeFs/)
  assert.doesNotMatch(code, /occlusionAtlas|irradianceAtlas/)
})

test('where the probes cover the eye the trace ends at their coverage and their eight probes give the far light', () => {
  const code = sceneVisualizeWgsl('rgba16float')
  assert.match(code, /cover=cacheCoverage\(eye,0\.5\);/)
  assert.match(code, /reach=min\(reach,cover\.minTrace\*f32\(BOUNCE_CM\)\)/)
  assert.match(code, /for\(var i=0u;i<8u;i\+\+\)\{/)
  assert.match(code, /let correction=t\*t\/\(radius\*dot\(towards,d\)\);/)
  assert.match(code, /mix\(out\.radiance,skyProbeRadiance\(d\),out\.sky\)/)
})

test('the eye mark takes the finest level that holds the eye half a cell inside its edge', () => {
  assert.match(EYE_MARK_SHADER, /markPointBiased\(bounce\.eye\.xyz,0\.5,0u\);/)
  assert.match(EYE_MARK_SHADER, /@workgroup_size\(1\)/)
})
