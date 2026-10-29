// The render of the volumetric shadow map from the grids: the matrices of its faces, its parameters and its kernel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { packGridParams } from '../voxelGrid/gridPack.ts'
import { VG_GRID_PARAMS_BYTES } from '../voxelGrid/gridEvalWgsl.ts'
import { avsmRenderProgram, AVSM_RENDER_PARAMS_BYTES } from './renderVolumetricShadowMapWgsl.ts'
import {
  orthographicShadowToWorld,
  perspectiveShadowToWorld,
  shadowPointToWorld,
  type FaceBasis,
} from './shadowFaceMatrix.ts'
import { packRenderParams } from './volumetricShadowEncode.ts'

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`))

const BASIS: FaceBasis = { origin: [1, 2, 3], forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] }

test('a perspective face: the texel centre ray runs from the near plane to the far one along the face axis', () => {
  const m = perspectiveShadowToWorld(BASIS, [1, 1], 1, 100)
  close(shadowPointToWorld(m, 0.5, 0.5, 1), [1, 2, 4])
  close(shadowPointToWorld(m, 0.5, 0.5, 0), [1, 2, 103])
  // The corners are at 45 degrees: the left edge (u = 0) is one to the left of the axis for each unit of depth, the top (v = 0) one above.
  close(shadowPointToWorld(m, 0, 0, 1), [1 - 1, 2 + 1, 4])
  close(shadowPointToWorld(m, 1, 1, 0), [1 + 100, 2 - 100, 103])
  // The tangents of a narrower view scale the spread.
  const narrow = perspectiveShadowToWorld(BASIS, [0.5, 0.25], 2, 50)
  close(shadowPointToWorld(narrow, 1, 0, 1), [1 + 0.5 * 2, 2 + 0.25 * 2, 5])
})

test('an orthographic face: a box of the radius across, the length deep, the near plane at the origin', () => {
  const m = orthographicShadowToWorld(BASIS, 10, 30)
  close(shadowPointToWorld(m, 0.5, 0.5, 1), [1, 2, 3])
  close(shadowPointToWorld(m, 0.5, 0.5, 0), [1, 2, 33])
  close(shadowPointToWorld(m, 0, 0, 1), [1 - 10, 2 + 10, 3])
  close(shadowPointToWorld(m, 1, 1, 0), [1 + 10, 2 - 10, 33])
})

test('the render parameters are laid out as the kernel reads them', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const bytes = packRenderParams({
    resolution: [512, 256],
    maxSampleCount: 8,
    jitter: true,
    stepSize: 2,
    maxStepCount: 512,
    debugTweak: 0,
    frameIndexMod8: 5,
    absoluteError: 0,
    relativeError: 0.05,
    compress: true,
    temporalJitter: [0.25, 0.75],
    distanceFrom: [3, 4, 5],
    shadowToWorld: [identity, identity.map((v) => v * 2)],
  })
  assert.equal(bytes.byteLength, AVSM_RENDER_PARAMS_BYTES)
  const i = new Int32Array(bytes)
  const f = new Float32Array(bytes)
  assert.deepEqual(Array.from(i.slice(0, 4)), [512, 256, 8, 1])
  assert.equal(f[4], 2)
  assert.deepEqual(Array.from(i.slice(5, 8)), [512, 0, 5])
  assert.ok(Math.abs(f[9] - 0.05) < 1e-7)
  assert.equal(i[10], 1)
  assert.deepEqual(Array.from(f.slice(12, 14)), [0.25, 0.75])
  assert.deepEqual(
    Array.from(f.slice(16, 20)),
    [3, 4, 5, 1],
    'the distances are measured from a point',
  )
  assert.deepEqual(Array.from(f.slice(20, 36)), identity)
  assert.deepEqual(
    Array.from(f.slice(36, 52)),
    identity.map((v) => v * 2),
  )
})

test('the grid parameters carry each grid with its flag; a grid that is not built is not read', () => {
  const m = Array.from({ length: 16 }, (_, k) => k)
  const bytes = packGridParams({
    ortho: { min: [-1, -2, -3], max: [4, 5, 6], resolution: [7, 8, 9] },
    indirection: true,
    worldToView: m,
    nearDepth: 1,
    farDepth: 50,
    tanHalfFov: 0.5,
    cellVoxels: 16,
  })
  assert.equal(bytes.byteLength, VG_GRID_PARAMS_BYTES)
  const i = new Int32Array(bytes)
  const f = new Float32Array(bytes)
  assert.deepEqual(Array.from(f.slice(0, 3)), [-1, -2, -3])
  assert.equal(i[3], 1)
  assert.deepEqual(Array.from(f.slice(4, 7)), [4, 5, 6])
  assert.equal(i[7], 1)
  assert.deepEqual(Array.from(i.slice(8, 11)), [7, 8, 9])
  assert.equal(i[11], 0, 'no frustum grid')
  assert.equal(f[15], 1)
  assert.equal(f[19], 50)
  assert.equal(f[23], 0.5)
  assert.deepEqual(Array.from(f.slice(24, 40)), m)
  assert.equal(i[40], 16, 'the voxels along a side of a top-level cell')
})

test('the render kernel binds the grids, the lists, the debug strip and the noise, and ends each list as the reference does', () => {
  const text = avsmRenderProgram('rgba16float')
  assert.deepEqual(
    [...text.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1])).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  )
  assert.match(text, /fn renderVolumetricShadowMap\(/)
  assert.equal(text.includes('`'), false)
  // A ray that meets no grid is one sample at distance 0; a march ends with the transmittance of its end, as a luminance.
  assert.match(text, /avsmSample\(0\.0,luminance\(transmittance\)\)/)
  assert.match(text, /avsmSample\(measured\+hitT,luminance\(transmittance\)\)/)
  assert.match(avsmRenderProgram('rgba32float'), /texture_storage_2d<rgba32float,write>/)
})
