// The angle one pixel spans at the eye (`eyeToPixelSpread`): the arctangent of 2 · tan(half the horizontal field of view) over the
// image's height, none under an orthographic projection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { eyeToPixelSpread } from './screenSlab.ts'

/** A column-major view-projection whose row x is `(scale, 0, 0, w)`: the horizontal scale of a perspective (`w` 1: clip w is the depth) or of an orthographic projection (`w` 0). */
const projection = (scale: number, perspective: boolean) => [
  scale,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  perspective ? 1 : 0,
  0,
  0,
  0,
  1,
]

test('a pixel spans the arctangent of twice the half field of view’s tangent over the image’s height', () => {
  // A scale of 1 is a half field of view of 45°: 2 · tan 45° = 2.
  assert.ok(Math.abs(eyeToPixelSpread(projection(1, true), 100) - Math.atan(2 / 100)) < 1e-12)
  // A narrower field (scale 2: tan = ½) over a taller image.
  assert.ok(Math.abs(eyeToPixelSpread(projection(2, true), 400) - Math.atan(1 / 400)) < 1e-12)
})

test('an orthographic projection has no field of view: none', () => {
  assert.equal(eyeToPixelSpread(projection(1, false), 100), 0)
})
