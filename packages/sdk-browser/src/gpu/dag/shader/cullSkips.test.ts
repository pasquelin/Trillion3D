// Two tests the DAG kernel does not make, each on a verdict it already knows. The normal cone
// first asks whether its axis points away from the camera (`coneWgsl.ts`): the only case the rest
// can reject, so the verdict is the same — except a cluster seen edge-on, which the GPU `sin` error
// rejected and the CPU mirror keeps. The frustum skips an infinite far plane (`outsideFrustum`),
// which reaches the kernel as NaN and rejects no box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { DAG_CONE_WGSL } from './coneWgsl.ts'
import { random } from '../../../page/cut/cutRuleChecks.fixture.ts'
import { cameraSelectionUniforms } from '../../core/selection.ts'
import { createEngineCamera, writeEngineCamera } from '../../../camera/engineCamera.ts'
import { HALF_PI, boxConeRejects, frustumExcludesBox } from '../../../../../sdk-core/src/index.ts'
import { frustumPlanesToLocal } from '../oracle/math.fixture.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'

/** The end of `coneRejectsBox`, with `sin` given: before and after the early exit. */
const before = (d: number, total: number, sin: (x: number) => number) =>
  d < -sin(total) && total < HALF_PI
const after = (d: number, total: number, sin: (x: number) => number) =>
  d < 0 && before(d, total, sin)
/** WGSL's `sin`, at its worst: an absolute error of 2^-11 on [-pi, pi]. */
const gpuSin = (x: number) => Math.sin(x) - 2 ** -11

test('the cone exits early before its arcsine: every verdict kept, on random and edge inputs', () => {
  const text = wgslSource(DAG_CONE_WGSL)
  assert.ok(text.indexOf('if(!(d<0.0)){return false;}') < text.indexOf('let radius='))
  const next = random(906)
  const ds = [NaN, -Infinity, -1, -1e-7, -0, 0, 1e-7, 1, Infinity]
  const totals = [NaN, 0, -0, 1e-7, 1, HALF_PI - 1e-7, HALF_PI, Math.PI, Infinity]
  for (let n = 0; n < 200; n++) {
    ds.push(next() * 2 - 1)
    totals.push(next() * Math.PI)
  }
  for (const d of ds)
    for (const total of totals)
      assert.equal(after(d, total, Math.sin), before(d, total, Math.sin), `${d}, ${total}`)
})

test('a cluster seen edge-on is kept, as the CPU mirror keeps it, whatever the GPU sin error', () => {
  // Axis along x, a point box straight ahead down -z: the axis is square to the view, d = 0.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const normal = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const box = [0, 0, -5]
  assert.equal(boxConeRejects([1, 0, 0], 0, box, box, identity, normal, 1, 0, 0, 0), false)
  assert.equal(before(0, 0, gpuSin), true, 'the old order rejected it on the GPU')
  assert.equal(after(0, 0, gpuSin), false)
  assert.equal(after(-0, 0, gpuSin), false)
})

/** The planes a camera sends the kernel, `far` given, and whether `farless` reads them as farless. */
function cameraPlanes(far: number) {
  const cam = createEngineCamera()
  cam.world.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1])
  writeEngineCamera(cam, { fov: 60, aspect: 16 / 9, near: 0.1, far, zoom: 1 })
  const { planes } = cameraSelectionUniforms(cam, 1, [1280, 720])
  const bits = new Uint32Array(Float32Array.from(planes).buffer)
  return { planes: Float64Array.from(planes), farless: (bits[16] & 0x7fffffff) > 0x7f800000 }
}

test('an infinite far plane is read as absent, a declared one is tested', () => {
  assert.ok(DAG_SELECTION_SHADER.includes('if(i!=skip&&outsidePlane('))
  assert.equal(cameraPlanes(Infinity).farless, true)
  assert.equal(cameraPlanes(2000).farless, false)
})

test('skipping the infinite far plane keeps every box verdict, in any primitive space', () => {
  const { planes } = cameraPlanes(Infinity)
  const skipped = planes.slice()
  skipped.set([0, 0, 0, 1], 16)
  const next = random(2222),
    local = new Float64Array(24),
    localSkipped = new Float64Array(24)
  const worlds = [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 5, -3, 7, 1],
  ]
  for (const world of worlds) {
    frustumPlanesToLocal(local, planes, world)
    frustumPlanesToLocal(localSkipped, skipped, world)
    assert.ok(Number.isNaN(local[16]), 'NaN through the primitive product')
    for (let n = 0; n < 5000; n++) {
      const c = [0, 1, 2].map(() => (next() - 0.5) * 2e4),
        h = [0, 1, 2].map(() => next() * 10 ** (next() * 4))
      const box = [c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]]
      assert.equal(
        frustumExcludesBox(
          localSkipped,
          ...(box as [number, number, number, number, number, number]),
        ),
        frustumExcludesBox(local, ...(box as [number, number, number, number, number, number])),
      )
    }
  }
})
