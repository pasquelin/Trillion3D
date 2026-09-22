import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  HOST_BLENDING_NORMAL,
  HOST_FILTER_LINEAR,
  HOST_FILTER_LINEAR_MIP_LINEAR,
  HOST_FILTER_LINEAR_MIP_NEAREST,
  HOST_FILTER_NEAREST,
  HOST_FILTER_NEAREST_MIP_LINEAR,
  HOST_FILTER_NEAREST_MIP_NEAREST,
  HOST_MAPPING_UV,
  HOST_NORMAL_MAP_TANGENT_SPACE,
  HOST_WRAP_CLAMP_TO_EDGE,
  HOST_WRAP_MIRRORED_REPEAT,
  HOST_WRAP_REPEAT,
} from './hostSurfaceConstants.ts';

// The engine path no longer names the host library to compare a sampler state or a blend
// equation; this test does, so that the names above stay the host's own numbers.
test('the engine names the host surface constants by the values the host declares', () => {
  assert.deepEqual(
    [
      HOST_WRAP_REPEAT,
      HOST_WRAP_CLAMP_TO_EDGE,
      HOST_WRAP_MIRRORED_REPEAT,
      HOST_FILTER_NEAREST,
      HOST_FILTER_NEAREST_MIP_NEAREST,
      HOST_FILTER_NEAREST_MIP_LINEAR,
      HOST_FILTER_LINEAR,
      HOST_FILTER_LINEAR_MIP_NEAREST,
      HOST_FILTER_LINEAR_MIP_LINEAR,
      HOST_MAPPING_UV,
      HOST_BLENDING_NORMAL,
      HOST_NORMAL_MAP_TANGENT_SPACE,
    ],
    [
      THREE.RepeatWrapping,
      THREE.ClampToEdgeWrapping,
      THREE.MirroredRepeatWrapping,
      THREE.NearestFilter,
      THREE.NearestMipmapNearestFilter,
      THREE.NearestMipmapLinearFilter,
      THREE.LinearFilter,
      THREE.LinearMipmapNearestFilter,
      THREE.LinearMipmapLinearFilter,
      THREE.UVMapping,
      THREE.NormalBlending,
      THREE.TangentSpaceNormalMap,
    ],
  );
});
