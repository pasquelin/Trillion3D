// Lot 3, frustum.ts: normalized frustum planes in REVERSED depth and raw clip planes, each
// compared against an independent plane extraction built from the host library's matrix and
// vector primitives, down to the bit.
//
// Engine depth is reversed: the plane bounding the NEAR is what standard depth called FAR,
// and vice versa. The six planes of the same matrix are therefore exactly those of the `[0, 1]` extraction,
// with the last two swapped — and this swap, and nothing else, is what `swapNearFar` describes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  clipPlanesFromMatrix,
  frustumPlanesFromMatrix,
} from '../../../../../../../packages/sdk-core/src/index.ts'
import { assertBits } from '../../../../../../../tests/kit/assert/bits.ts'

/** The six planes of the independent extraction copied flat, normal then constant. It is always read
 *  in `[0, 1]` clipping: that is the engine's range, and only depth DIRECTION is reversed —
 *  which swaps the last two planes, and nothing else. */
function planesFromThreeFrustum(
  m: THREE.Matrix4,
  Type: Float64ArrayConstructor | Float32ArrayConstructor,
) {
  const tronc = new THREE.Frustum().setFromProjectionMatrix(m, THREE.WebGPUCoordinateSystem)
  const output = new Type(24)
  tronc.planes.forEach((p, i) =>
    output.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4),
  )
  return output
}

/** The `[0, 1]` planes with their last two swapped: what reversed depth expects, plane for plane. */
function swapNearFar(planes: Float64Array | Float32Array) {
  const output = planes.slice()
  output.set(planes.subarray(20, 24), 16)
  output.set(planes.subarray(16, 20), 20)
  return output
}

function camera(webgpu: boolean, orthographic: boolean) {
  const cam = orthographic
    ? new THREE.OrthographicCamera(-8, 8, 5, -5, 0.2, 250)
    : new THREE.PerspectiveCamera(55, 1.4, 0.15, 400)
  cam.coordinateSystem = webgpu ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem
  cam.updateProjectionMatrix()
  cam.position.set(3, -2, 5)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
}

for (const webgpu of [false, true]) {
  for (const orthographic of [false, true]) {
    test(`frustumPlanesFromMatrix matches the independent plane extraction (webgpu=${webgpu}, ortho=${orthographic})`, () => {
      const m = camera(webgpu, orthographic)
      const actual = new Float64Array(24)
      frustumPlanesFromMatrix(actual, m.elements)
      assertBits(actual, swapNearFar(planesFromThreeFrustum(m, Float64Array)))
    })
  }
}

test('frustumPlanesFromMatrix in single precision rounds once, like a Float32 uniform', () => {
  const m = camera(true, false)
  const actual = new Float32Array(24)
  frustumPlanesFromMatrix(actual, m.elements)
  assertBits(actual, swapNearFar(planesFromThreeFrustum(m, Float32Array)))
})

test('clipPlanesFromMatrix yields raw sums and differences of matrix rows', () => {
  const m = camera(false, false)
  const actual = new Float64Array(24)
  clipPlanesFromMatrix(actual, m.elements)
  assertBits(actual, expectedClipPlanes(m))
})

/** The six raw (unnormalized) planes copied from the independent extraction, the last two
 *  already in reversed depth order —
 *  same construction as the `clipPlanesFromMatrix` test above, factorized for interleaving
 *  below. */
function expectedClipPlanes(m: THREE.Matrix4) {
  const e = m.elements
  const w = new THREE.Vector4(e[3], e[7], e[11], e[15])
  const rows = [
    new THREE.Vector4(e[0], e[4], e[8], e[12]),
    new THREE.Vector4(e[1], e[5], e[9], e[13]),
    new THREE.Vector4(e[2], e[6], e[10], e[14]),
  ]
  const expected = new Float64Array(24)
  // Four side planes, then FAR — the only depth row without `w` — and NEAR.
  ;[
    [0, -1],
    [0, 1],
    [1, 1],
    [1, -1],
    [2, 0],
    [2, -1],
  ].forEach(([k, sign], i) => {
    const p = sign === 0 ? new THREE.Vector4().copy(rows[k]) : new THREE.Vector4().copy(w)
    if (sign > 0) p.add(rows[k])
    else if (sign < 0) p.sub(rows[k])
    expected.set([p.x, p.y, p.z, p.w], i * 4)
  })
  return expected
}

// perf(socle) e5509b57: the four components of a plane are passed as arguments to `writePlane`
// and no longer via a module buffer (`plane`, a `Float64Array(4)` shared across calls).
// Without this buffer, two interleaved frustum computations — each in its own `out` — can no longer
// collide; there is nothing left to allocate or reuse per call. Verify this with two
// very different frustums whose writes are manually interleaved, each compared against
// the independent extraction.
test('frustumPlanesFromMatrix and clipPlanesFromMatrix: no shared buffer, two interleaved frustums remain independent', () => {
  const m1 = camera(false, false)
  const m2 = camera(true, true)
  const actual1 = new Float64Array(24)
  const actual2 = new Float64Array(24)
  const clip1 = new Float64Array(24)
  const clip2 = new Float64Array(24)
  // Interleaved writes: if a component still passed through a shared module buffer,
  // this order would cause it to be overwritten by the next call before reading.
  frustumPlanesFromMatrix(actual1, m1.elements)
  clipPlanesFromMatrix(clip2, m2.elements)
  frustumPlanesFromMatrix(actual2, m2.elements)
  clipPlanesFromMatrix(clip1, m1.elements)
  assertBits(actual1, swapNearFar(planesFromThreeFrustum(m1, Float64Array)))
  assertBits(actual2, swapNearFar(planesFromThreeFrustum(m2, Float64Array)))
  assertBits(clip1, expectedClipPlanes(m1))
  assertBits(clip2, expectedClipPlanes(m2))
})

test('a NaN or zero projection matrix yields NaN or infinite planes, without throwing', () => {
  for (const m of [new Array(16).fill(NaN), new Array(16).fill(0)]) {
    const output = new Float64Array(24)
    assert.doesNotThrow(() => frustumPlanesFromMatrix(output, m))
    assert.doesNotThrow(() => clipPlanesFromMatrix(output, m))
  }
})
