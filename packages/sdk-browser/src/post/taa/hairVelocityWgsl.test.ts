// The hair strands' velocity entry of the velocity stage, read from the shipped text: it writes only where a strand is nearer
// than the surface, with the vector of the camera's motion at the strand's depth, flagged as a pixel that moves by itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { SURFACE_VELOCITY_WGSL } from './surfaceVelocityWgsl.ts'
import { PIXEL_ANIMATED, PIXEL_RESTARTS } from './velocityWgsl.ts'

const entry = SURFACE_VELOCITY_WGSL.slice(SURFACE_VELOCITY_WGSL.indexOf('fn hairVelocity('))

test('the hair velocity entry reads the strands depth in group 1 and leaves the texels no strand is nearer than', () => {
  assert.match(SURFACE_VELOCITY_WGSL, /@group\(1\) @binding\(1\) var hairDepth:texture_2d<f32>;/)
  assert.match(entry, /let strand=textureLoad\(hairDepth,p,0\)\.x;/)
  // Reverse-Z: nearer is greater, and 0 is no strand.
  assert.match(entry, /if\(!\(strand>textureLoad\(depth,p,0\)\)\)\{return;\}/)
})

test('the hair velocity is the camera motion at the strand depth, flagged as a surface that moves by itself', () => {
  assert.match(entry, /let motion=cameraMotion\(screenOfTexel\(p\),strand\);/)
  assert.match(entry, /encodeOwnVector\(motion\.xy,true\)/)
  assert.match(entry, new RegExp(`withDepthStep\\(${PIXEL_ANIMATED}u,motion\\.z\\)`))
})

test('the velocity stage names everything the hair entry uses', () => {
  assert.deepEqual(unresolvedNames(SURFACE_VELOCITY_WGSL), [])
})

test('the hair velocity writes only where the strands cover the pixel to the coverage threshold', () => {
  const walk = SURFACE_VELOCITY_WGSL.slice(SURFACE_VELOCITY_WGSL.indexOf('fn hairSamples('))
  assert.match(walk, /textureLoad\(hairCoverage,p,0\)\.r<hairRule\.coverage/)
  assert.match(walk, /if\(samples\.count==0u\)\{return;\}/)
})

test('the hair velocity modes take the nearest, the mean or the largest of the samples, and mark a fast sample for a resolve at once', () => {
  const walk = SURFACE_VELOCITY_WGSL.slice(SURFACE_VELOCITY_WGSL.indexOf('fn hairSamples('))
  assert.match(SURFACE_VELOCITY_WGSL, /override HAIR_VELOCITY_MAX:bool=false;/)
  assert.match(
    walk,
    /select\(samples\.sum\/f32\(samples\.count\),samples\.peak,HAIR_VELOCITY_MAX\)/,
  )
  assert.match(walk, /if\(size>peakSize\)\{out\.peak=motion;peakSize=size;\}/)
  assert.match(walk, /out\.fast=out\.fast\|\|length\(motion\.xy\)>hairRule\.threshold;/)
  assert.match(walk, new RegExp(`select\\(0u,${PIXEL_RESTARTS}u,fast\\)`))
})
