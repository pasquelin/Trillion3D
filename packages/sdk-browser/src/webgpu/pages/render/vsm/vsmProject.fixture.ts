// The cameras and view headers the shadow projection's proofs compare (`vsmProject*.test.ts`): the
// projection `vsmProject.ts` uploads, `taaRenderProjection`, against the old round trip through the
// view's inverse, `J(P·V)·V⁻¹`, and the f32 arithmetic the shader reads their header words with.
import { createEngineCamera, writeEngineCamera } from '../../../../camera/engineCamera.ts'
import { taaRenderMatrix, taaRenderProjection } from '../../../../taa/frame.ts'
import { createTaaFrameState } from '../../../../taa/frameState.ts'
import { jitterViewProjection, taaJitter } from '../../../../taa/jitter.ts'
import { encodeVirtualShadowProjection } from '../../../../vsm/projectionPass.ts'
import { createVsmResources } from '../../../../vsm/resources.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { HALTON_SWEEP, haltonSpan } from '../../../../../../math/src/sequence/sweep.fixture.ts'
import { halton } from '../../../../../../math/src/sequence/halton.ts'
import { multiplyMatrix4 } from '../../../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../../../math/src/matrix/matrix4Inverse.ts'
import { composeMatrix4 } from '../../../../../../math/src/matrix/matrix4Compose.ts'
import { yawPitchQuaternion } from '../../../../../../math/src/quaternion/quaternion.ts'
import { fakeDevice } from '../../../../../../../tests/kit/gpu/fakeDevice.ts'

const frame = createTaaFrameState()
export const cam = createEngineCamera(),
  rt = { gpu: { temporal: { frame } } } as unknown as WebgpuPagesRuntime,
  viewInverse = new Float64Array(16),
  /** The old projection: the render matrix through the view's inverse. */
  roundTrip = new Float64Array(16),
  /** The projection the pass uploads now (`taaRenderProjection`). */
  now = new Float64Array(16)
const turn = new Float64Array(4)

/** Camera `i` of the sweep: an eye anywhere in a 40 km world, any heading, a field of 20° to 100°
 *  or an orthographic box (one in four), a target of 64 to 4096 pixels a side; jittered when
 *  `active` (temporal accumulation on), the camera's own projection when not. */
export function camera(i: number, active = true) {
  const eye = [2, 3, 5].map((base) => haltonSpan(i, base, -2e4, 2e4))
  yawPitchQuaternion(turn, haltonSpan(i, 7, -Math.PI, Math.PI), haltonSpan(i, 11, -1.5, 1.5))
  composeMatrix4(cam.world, eye, turn, [1, 1, 1])
  const half = haltonSpan(i, 31, 0.5, 500)
  writeEngineCamera(cam, {
    fov: haltonSpan(i, 13, 20, 100),
    aspect: haltonSpan(i, 17, 0.5, 2.5),
    near: haltonSpan(i, 19, 0.01, 1),
    far: 1e5,
    zoom: 1,
    orthographic: i % 4 ? null : { left: -half, right: half, top: half, bottom: -half },
  })
  frame.active = active
  taaJitter(i, frame.jitter, 37)
  frame.jitterGrid[0] = Math.round(haltonSpan(i, 23, 64, 4096))
  frame.jitterGrid[1] = Math.round(haltonSpan(i, 29, 64, 4096))
  const [jx, jy] = frame.jitter,
    [width, height] = frame.jitterGrid
  jitterViewProjection(frame.viewProjection, cam.viewProjection, jx, jy, width, height)
  invertMatrix4(viewInverse, cam.view)
  multiplyMatrix4(roundTrip, Float64Array.from(taaRenderMatrix(rt, cam)), viewInverse)
  taaRenderProjection(rt, cam, now)
  return { width, height, dx: (2 * jx) / width, dy: (2 * jy) / height }
}

const { device, writes } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } }),
  res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 }),
  texture = {} as GPUTextureView,
  pass = new Proxy({}, { get: () => () => {} }),
  encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder

/** The f32 view header the projection pass uploads for `projection` (`VsmProjectionView`):
 *  shiftedToClip at word 0, shiftedToView 16, viewToClip 32, clipToShifted 48, the screen's
 *  words from 84. */
function header(projection: Float64Array, width: number, height: number) {
  writes.length = 0
  const camera = { view: cam.view, projection, perspective: cam.perspective === 1 }
  const inputs = { device, depth: texture, normalRough: texture, flags: texture, mask: texture }
  encodeVirtualShadowProjection(
    encoder,
    res,
    { ...inputs, maskTiles: texture, width, height, frameIndex: 0, camera },
    [],
  )
  const bytes = writes.find(
    (w) => (w.buffer as { label?: string }).label === 'vsm.projection.view',
  )!.data as Uint8Array
  return new Float32Array(bytes.buffer, bytes.byteOffset, 104).slice()
}

export const f = Math.fround
/** `m · (x, y, z, w)` as the shader multiplies it, in f32: each product and sum rounded. */
export const transform = (m: ArrayLike<number>, x: number, y: number, z: number, w: number) =>
  [0, 1, 2, 3].map((r) =>
    f(f(f(f(m[r] * x) + f(m[4 + r] * y)) + f(m[8 + r] * z)) + f(m[12 + r] * w)),
  )

/** `vsmViewDepthOfDeviceZ` of device depth `z` from the header's depth words (80-83), in f32. */
export const viewDepth = (h: Float32Array, z: number) =>
  f(f(f(z * h[80]) + h[81]) + f(1 / f(f(z * h[82]) - h[83])))

/** `vsmPixelToShifted` of pixel `(px, py)` at device depth `z`, under header `h`, in f32. */
export function shifted(h: Float32Array, px: number, py: number, z: number) {
  const u = f(f(px + 0.5) * h[94]),
    v = f(f(py + 0.5) * h[95])
  const c = transform(h.subarray(48, 64), f(f(u * 2) - 1), f(1 - f(v * 2)), z, 1)
  return [f(c[0] / c[3]), f(c[1] / c[3]), f(c[2] / c[3])]
}

/** Camera `i`'s 64 samples of the screen: 16 pixels by 4 device depths, near plane to 2¹⁷ times
 *  it for a perspective camera, across the box for an orthographic one. */
export function pixelSamples(i: number, width: number, height: number) {
  const samples: { px: number; py: number; z: number; key: number }[] = []
  for (let j = 1; j <= 16; j++) {
    const px = Math.floor(haltonSpan(i * 16 + j, 2, 0, width)),
      py = Math.floor(haltonSpan(i * 16 + j, 3, 0, height))
    for (let n = 1; n <= 4; n++) {
      const key = i * 64 + j * 4 + n,
        t = halton(key, 5)
      samples.push({ px, py, z: f(cam.perspective === 1 ? 2 ** (-t * 17) : t), key })
    }
  }
  return samples
}

/** Camera `i`'s sun direction, unit length in f32. */
function sunDirection(i: number) {
  const d = [37, 41, 43].map((b) => haltonSpan(i, b, -1, 1)),
    length = Math.hypot(d[0], d[1], d[2])
  return d.map((x) => f(x / length))
}

/** Every camera of the sweep, temporal accumulation on then off, with the f32 header of the old
 *  round trip (`old`) and of `taaRenderProjection` (`fresh`). */
export function* sweptHeaders() {
  for (const active of [true, false])
    for (let i = 1; i <= HALTON_SWEEP; i++) {
      const { width, height } = camera(i, active)
      const old = header(roundTrip, width, height),
        fresh = header(now, width, height)
      yield {
        i,
        active,
        width,
        height,
        old,
        fresh,
        at: `camera ${i} ${active ? 'jittered' : 'still'}`,
      }
    }
}

/** Every sample of `sweptHeaders`' cameras (`pixelSamples`), with the camera's sun direction and
 *  the shifted point rebuilt from each header: `point` from the fresh one, `own` from the old. */
export function* sweptSamples() {
  for (const swept of sweptHeaders()) {
    const sun = sunDirection(swept.i)
    for (const sample of pixelSamples(swept.i, swept.width, swept.height)) {
      const { px, py, z, key } = sample,
        point = shifted(swept.fresh, px, py, z),
        own = shifted(swept.old, px, py, z)
      yield { ...swept, ...sample, sun, point, own, at: `${swept.at} sample ${key}` }
    }
  }
}
