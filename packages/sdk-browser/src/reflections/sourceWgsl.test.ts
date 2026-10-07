import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun, Mat } from '../texture/shaderRun.fixture.ts'
import { REFLECTION_SOURCE_WGSL } from './sourceWgsl.ts'

const LIT = [3, 5, 7, 1]

function fixture() {
  const samples: Record<string, number | number[]> = {
    depth: 0.5,
    ids: [0x107, 0, 0, 0],
    lastDepth: 0.5,
    lastIds: [0x107, 0, 0, 0],
  }
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  // x: a last image was kept; y: a placement moved that no live motion follows; z: live motion.
  const view = {
    prevViewProj: identity,
    invViewProj: identity,
    viewport: [8, 8, 1 / 8, 1 / 8],
    params: [1, 0, 0, 0],
    last: [8, 8, 1 / 8, 1 / 8],
  }
  const uv = [0.5, 0.5, 1]
  const { reprojectReflectionSource } = shaderRun<{
    reprojectReflectionSource: (pixel: number[]) => number[]
  }>(
    REFLECTION_SOURCE_WGSL,
    ['reprojectReflectionSource', 'previousDepthOf', 'pixelPoint', 'pointBefore', 'placementOf'],
    {
      ...Object.fromEntries(Object.keys(samples).map((key) => [key, key])),
      lastImage: 'lastImage',
      lastSampler: 'lastSampler',
      view,
      motion: [identity],
      pages: [{ placement: 0 }],
      previousUv: () => uv,
      dpdx: () => 0,
      dpdy: () => 0,
      textureLoad: (name: string) => samples[name],
      textureSampleLevel: () => LIT,
    },
  )
  return { samples, view, uv, source: () => reprojectReflectionSource([4.5, 4.5, 0, 1]) }
}

test('a point seen on the last image takes its unfogged colour there', () => {
  assert.deepEqual(fixture().source(), [3, 5, 7, 1])
})

// A point hidden on the last image was reprojected onto its occluder and took its colour.
test('a point hidden on the last image misses: its depth there is another surface', () => {
  const f = fixture()
  f.samples.lastDepth = 0.6
  assert.deepEqual(f.source(), [0, 0, 0, 0])
})

// Without the temporal pass a mover was found where it is and coloured where it was.
test('while a placement moved that no live motion follows, a point on another triangle misses', () => {
  const f = fixture()
  f.samples.lastIds = [0x108, 0, 0, 0]
  assert.deepEqual(f.source(), LIT, 'nothing moved: the camera reprojection is exact')
  f.view.params[1] = 1
  assert.deepEqual(f.source(), [0, 0, 0, 0])
  f.samples.lastIds = [0x107, 0, 0, 0]
  assert.deepEqual(f.source(), LIT, 'the same triangle is the same point')
})

test('a first image and a point off the last image miss', () => {
  const first = fixture()
  first.view.params[0] = 0
  assert.deepEqual(first.source(), [0, 0, 0, 0])
  const off = fixture()
  off.uv[2] = 0
  assert.deepEqual(off.source(), [0, 0, 0, 0])
})
