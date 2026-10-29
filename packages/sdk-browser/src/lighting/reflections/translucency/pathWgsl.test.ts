// The traced translucency's path (`pathWgsl.ts`): its events, its bending, its ends.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACED_PATH_WGSL, TRACED_PATH_OFFSET } from './pathWgsl.ts'

const { text } = TRACED_PATH_WGSL

test('the text holds no backtick and no reserved word as a name', () => {
  assert.ok(!text.includes('`'))
  assert.doesNotMatch(text, /\b(?:var|let)\s+(?:ref|target|filter|override|enable|sample)\b/)
})

test('a primary ray starts 0.05 cm in and a bent one at zero', () => {
  assert.equal(TRACED_PATH_OFFSET, 0.0005)
  assert.match(text, /select\(0\.0005,0\.0,primaryBent\)/)
})

test('a primary ray is cast against the translucent surfaces alone while it is straight', () => {
  assert.match(text, /rttScene\(ray\.origin,ray\.dir,ray\.tMin,ray\.tMax,s==0&&!bent,!bent\)/)
})

test('refraction always samples the refracted ray (the pick is one) and the exit of a surface uses the inverse index', () => {
  assert.match(text, /rttSampleRefraction\(ray\.dir,h,m\.ior,1\.0,&refracted,&fresnel\)/)
  assert.match(text, /rttSampleRefraction\(ray\.dir,surf\.normal,1\.0\/m\.ior,1\.0,&dir,&fresnel\)/)
})

test('an opaque hit ends the primary path and a back face of a translucent surface costs no event once refracted', () => {
  assert.match(text, /primaryThroughput=vec3f\(0\.0\);p=RTT_MAX_PRIMARY-1;/)
  assert.match(text, /if\(refracted\)\{p--;\}/)
  assert.match(text, /if\(refracted\)\{s--;\}/)
})

test('the background visibility is locked by a refractive hit', () => {
  assert.match(text, /if\(refractive\)\{locked=true;\}/)
  assert.match(text, /select\(0\.0,dot\(primaryThroughput,vec3f\(1\.0\/3\.0\)\),!locked\)/)
})

test('a path ends when its throughput falls under the threshold', () => {
  assert.match(text, /if\(!rttAny\(primaryThroughput,RTT_THRESHOLD\)\)\{break;\}/)
})
