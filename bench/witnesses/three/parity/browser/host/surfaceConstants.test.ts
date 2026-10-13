import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  HOST_BLENDING_ADDITIVE,
  HOST_BLENDING_MULTIPLY,
  HOST_BLENDING_NONE,
  HOST_BLENDING_NORMAL,
  HOST_BLENDING_SUBTRACTIVE,
  HOST_DEPTH_LESS_EQUAL,
  HOST_NORMAL_MAP_TANGENT_SPACE,
} from '../../../../../../packages/sdk-browser/src/host/surfaceConstants.ts'

// The engine path does not name the host library to compare a blend equation or a raster state; this test does, so that the names above stay the host's own numbers.
test('the engine names the host surface constants by the values the host declares', () => {
  assert.deepEqual(
    [
      HOST_BLENDING_NONE,
      HOST_BLENDING_NORMAL,
      HOST_BLENDING_ADDITIVE,
      HOST_BLENDING_SUBTRACTIVE,
      HOST_BLENDING_MULTIPLY,
      HOST_NORMAL_MAP_TANGENT_SPACE,
      HOST_DEPTH_LESS_EQUAL,
    ],
    [
      THREE.NoBlending,
      THREE.NormalBlending,
      THREE.AdditiveBlending,
      THREE.SubtractiveBlending,
      THREE.MultiplyBlending,
      THREE.TangentSpaceNormalMap,
      THREE.LessEqualDepth,
    ],
  )
})
