// The horizon method's temporal history and its stored texture: the images drawn on the history are counted (a quiet view is
// drawn again until it has the images it needs), and the spatial filter stores its occlusion held from 0 to 1.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  beginCamera,
  cameraSeen,
  previousCameraOf,
} from '../../frame/backend/state/previousCamera.ts'
import { ambientOcclusionSettling } from './frame.ts'
import { runHorizon } from './horizon/chain.fixture.ts'
import { occlusionRuntime } from './occlusion.fixture.ts'

const worstOf = (a: number[][], b: number[][]) =>
  Math.max(...a.flatMap((row, y) => row.map((v, x) => Math.abs(v - b[y][x]))))

test('the horizon history counts the images drawn on it: a cut or a remade view starts the count again, a change of intensity does not', async () => {
  const run = await occlusionRuntime({ ambientOcclusionMethod: 'horizon' })
  const images = () => run.rt.gpu.ambientOcclusion?.history.images
  const settling = () => ambientOcclusionSettling(run.rt)
  for (let n = 1; n <= 21; n++) {
    await run.encode()
    assert.equal(images(), n)
    assert.equal(settling(), true, `${n} images: the view is drawn again`)
  }
  await run.encode()
  assert.equal(settling(), false, '22 images at the blend 0.1: settled')
  Object.assign(run.rt.context, { ambientOcclusionIntensity: 0.7 })
  await run.encode()
  assert.equal(images(), 23, 'a change of intensity keeps the history and its count')
  Object.assign(run.rt.run.gate, { temporalRevision: run.rt.run.gate.temporalRevision + 1 })
  await run.encode()
  assert.equal(images(), 1, 'a cut drops the history and the count')
  assert.equal(settling(), true)
  Object.assign(run.rt.context, { ambientOcclusionHorizonTemporal: false })
  await run.encode()
  assert.equal(settling(), false, 'no temporal filter, no history to wait for')
})

test('the spatial filter stores the occlusion held from 0 to 1, so that the sky beside a wall does not lighten the wall in the filters that read it', () => {
  // A floor under a sky: the search leaves the sky whole, which the filter takes to the integral's scale (1.285 at the defaults,
  // 2.47 at the power 4 and the intensity 1) and, unheld, would read linearly into the pixels along the skyline.
  for (const options of [{}, { ambientOcclusionPower: 4, ambientOcclusionIntensity: 1 }]) {
    const run = runHorizon({ floor: 1.5 }, options)
    const stored = run.wgsl.spatial
    const flat = stored.flat()
    assert.ok(
      Math.max(...flat) <= 1 && Math.min(...flat) >= 0,
      `held from 0 to 1: ${Math.max(...flat)}`,
    )
    assert.equal(stored[5][32], 1, 'the sky is exactly the unoccluded 1')
    assert.ok(worstOf(stored, run.apart.spatial) < 1e-6, 'and so is the filter written apart')
    // The temporal filter reads it a texel's eighth off the pixel's centre: the first image, over a white history, is the
    // pixel's value taken a tenth up and mixed a tenth in. Along the skyline it is that of the held values, and never above 1.
    const out = run.wgsl.history1
    assert.ok(Math.max(...out.flat()) <= 1 + 1e-6, 'nothing above the unoccluded 1')
    for (let y = 0; y < stored.length - 1; y++)
      for (const x of [31, 32, 33]) {
        const current =
          0.875 * (0.875 * stored[y][x] + 0.125 * stored[y][x + 1]) +
          0.125 * (0.875 * stored[y + 1][x] + 0.125 * stored[y + 1][x + 1])
        const owed = 0.9 * Math.min(current + 0.1, 1) + 0.1 * current
        assert.ok(
          Math.abs(out[y][x] - owed) < 1e-5,
          `row ${y} column ${x}: ${out[y][x]} against ${owed}`,
        )
      }
  }
})

test('the camera of the image before is kept once for the view: a history reads it where its last image is that one, and starts again where it skipped one', async () => {
  const run = await occlusionRuntime({ ambientOcclusionMethod: 'horizon' })
  const images = () => run.rt.gpu.ambientOcclusion?.history.images
  await run.encode()
  await run.encode()
  const before = previousCameraOf(run.rt)
  assert.equal(before.image, run.rt.run.frame - 1, 'the image before: its number and its camera')
  assert.deepEqual([...before.viewProjection], [...run.camera.viewProjection])
  const seen = run.rt.gpu.ambientOcclusion!.history.seen
  assert.equal(seen, run.rt.run.frame, 'the history’s last image is the one the occlusion drew')
  assert.equal(cameraSeen(before, 0), undefined, 'a history with no image holds no camera')
  assert.equal(cameraSeen(before, seen - 1), before, 'the image before is its image')
  assert.equal(
    cameraSeen(before, seen - 2),
    undefined,
    'an older image is no one’s camera any more',
  )
  assert.equal(images(), 2)
  // An image the occlusion was not drawn in: the frame begins its camera all the same, the history's image is no longer the one before.
  run.rt.run.frame++
  beginCamera(run.rt, run.camera)
  await run.encode()
  assert.equal(images(), 1, 'it starts again, as after a cut, over a camera nobody kept')
  await run.encode()
  assert.equal(images(), 2, 'and goes on from there')
  // The same image begun twice changes nothing.
  const [viewProjection, image] = [
    [...previousCameraOf(run.rt).viewProjection],
    previousCameraOf(run.rt).image,
  ]
  beginCamera(run.rt, run.camera)
  assert.deepEqual(
    [[...previousCameraOf(run.rt).viewProjection], previousCameraOf(run.rt).image],
    [viewProjection, image],
  )
})
