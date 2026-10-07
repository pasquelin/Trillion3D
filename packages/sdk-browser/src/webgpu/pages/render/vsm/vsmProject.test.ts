// The projection the shadow projection reconstructs each pixel with (`vsmProject.ts`) is the
// camera's projection windowed by the image's jitter (`taaRenderProjection`), where it was the
// jittered view-projection brought back through the view's inverse, `J(P·V)·V⁻¹`. Three proofs, on
// `HALTON_SWEEP` cameras of an open world: (1) it is the product `W·P` value for value, its depth
// rows P's bits; (2) the old round trip differs from it by rounding alone, bounded below; (3) the
// pixel's shifted position the shader rebuilds from either, emulated in f32, reads the same
// shadow texels.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngineCamera, writeEngineCamera } from '../../../../camera/engineCamera.ts'
import { taaRenderMatrix, taaRenderProjection } from '../../../../taa/frame.ts'
import { createTaaFrameState } from '../../../../taa/frameState.ts'
import { jitterViewProjection, taaJitter } from '../../../../taa/jitter.ts'
import { encodeVirtualShadowProjection } from '../../../../vsm/projectionPass.ts'
import { createVsmResources } from '../../../../vsm/resources.ts'
import { createVsmClipmap, type VsmClipmap } from '../../../../vsm/clipmap.ts'
import { VsmCacheManager } from '../../../../vsm/cacheManager.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { halton } from '../../../../../../math/src/sequence/halton.ts'
import { HALTON_SWEEP, haltonSpan } from '../../../../../../math/src/sequence/sweep.fixture.ts'
import { IDENTITY_MATRIX4, multiplyMatrix4 } from '../../../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../../../math/src/matrix/matrix4Inverse.ts'
import { composeMatrix4 } from '../../../../../../math/src/matrix/matrix4Compose.ts'
import { yawPitchQuaternion } from '../../../../../../math/src/quaternion/quaternion.ts'
import { fakeDevice } from '../../../../../../../tests/kit/gpu/fakeDevice.ts'

const cam = createEngineCamera(),
  frame = createTaaFrameState(),
  rt = { gpu: { temporal: { frame } } } as unknown as WebgpuPagesRuntime,
  turn = new Float64Array(4),
  window = new Float64Array(16),
  windowed = new Float64Array(16),
  viewInverse = new Float64Array(16),
  roundTrip = new Float64Array(16),
  now = new Float64Array(16)

/** Camera `i` of the sweep, jittered: an eye anywhere in a 40 km world, any heading, a field
 *  of 20° to 100° or an orthographic box (one in four), a target of 64 to 4096 pixels a side. */
function camera(i: number) {
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
  frame.active = true
  taaJitter(i, frame.jitter, 37)
  frame.jitterGrid[0] = Math.round(haltonSpan(i, 23, 64, 4096))
  frame.jitterGrid[1] = Math.round(haltonSpan(i, 29, 64, 4096))
  const [jx, jy] = frame.jitter,
    [width, height] = frame.jitterGrid
  jitterViewProjection(frame.viewProjection, cam.viewProjection, jx, jy, width, height)
  // The old projection: the render matrix through the view's inverse.
  invertMatrix4(viewInverse, cam.view)
  multiplyMatrix4(roundTrip, Float64Array.from(taaRenderMatrix(rt, cam)), viewInverse)
  taaRenderProjection(rt, cam, now)
  return { width, height, dx: (2 * jx) / width, dy: (2 * jy) / height }
}

test('the render projection is W·P value for value, its depth rows and an unjittered one P bits', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const { dx, dy } = camera(i)
    window.set(IDENTITY_MATRIX4)
    window[12] = dx
    window[13] = dy
    multiplyMatrix4(windowed, window, cam.projection)
    for (let k = 0; k < 16; k++) {
      assert.equal(now[k], windowed[k], `camera ${i} entry ${k}`)
      if (k % 4 > 1) assert.ok(Object.is(now[k], cam.projection[k]), `camera ${i} depth ${k}`)
    }
  }
  frame.active = false
  for (let k = 0; k < 16; k++)
    assert.ok(Object.is(taaRenderProjection(rt, cam, now)[k], cam.projection[k]))
})

test('the old round trip is the same projection to within 4 units of rounding of its terms', () => {
  // `J(P·V)·V⁻¹` sums four products per entry, `Σ_j JPV[r][j]·V⁻¹[j][c]`, each carrying the
  // rounding of the product and of the inverse; it can only be off by a few units of the largest
  // of them, `4·2⁻⁵²·Σ|terms|`. An exact zero of `W·P` is left out: the round trip leaves a
  // residue there, as large as the eye's distance makes those terms. Measured worst: 2.43.
  const jvp = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    camera(i)
    jvp.set(taaRenderMatrix(rt, cam))
    for (let k = 0; k < 16; k++) {
      if (now[k] === 0) continue
      const r = k % 4,
        c = k - r
      let terms = 0
      for (let j = 0; j < 4; j++) terms += Math.abs(jvp[r + 4 * j] * viewInverse[c + j])
      assert.ok(Math.abs(roundTrip[k] - now[k]) <= 4 * 2 ** -52 * terms, `camera ${i} entry ${k}`)
    }
  }
})

const { device, writes } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } }),
  res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 }),
  texture = {} as GPUTextureView,
  pass = new Proxy({}, { get: () => () => {} }),
  encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder

/** The f32 view header the projection pass uploads for `projection` (`VsmProjectionView`). */
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

const f = Math.fround
/** `m · (x, y, z, w)` as the shader multiplies it, in f32: each product and sum rounded. */
const transform = (m: ArrayLike<number>, x: number, y: number, z: number, w: number) =>
  [0, 1, 2, 3].map((r) =>
    f(f(f(f(m[r] * x) + f(m[4 + r] * y)) + f(m[8 + r] * z)) + f(m[12 + r] * w)),
  )

/** `vsmPixelToShifted` of pixel `(px, py)` at device depth `z`, under header `h`, in f32. */
function shifted(h: Float32Array, px: number, py: number, z: number) {
  const u = f(f(px + 0.5) * h[94]),
    v = f(f(py + 0.5) * h[95])
  const c = transform(h.subarray(48, 64), f(f(u * 2) - 1), f(1 - f(v * 2)), z, 1)
  return [f(c[0] / c[3]), f(c[1] / c[3]), f(c[2] / c[3])]
}

/** The sun texel the clipmap reads at shifted point `s`: the level of its distance, then
 *  `vec2u(mapUv · 16384)` on that level's shifted-to-UV matrix, all in f32; the light's numbers
 *  are the same for both headers, only the point differs. */
function texel(clipmap: VsmClipmap, view: ArrayLike<number>, s: number[]) {
  const levels = clipmap.cacheEntry.mapCaches.map((m) => m.projectionData)
  const base = levels[0],
    d = s.map((x, a) => f(x + f(base.originShift[a] - view[a] - base.clipmapOrigin[a])))
  const level = 0.5 * Math.log2(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2])) * 1e4)
  const k = Math.min(
    Math.max(Math.floor(level + base.levelBias) - base.mapLevel, 0),
    levels.length - 1,
  )
  const at = levels[k],
    p = s.map((x, a) => f(x + f(at.originShift[a] - view[a])))
  const uv = transform(at.shiftedToMapUv, p[0], p[1], p[2], 1)
  return `${k}:${Math.floor(f(uv[0] * 16384))}:${Math.floor(f(uv[1] * 16384))}`
}

test('class 1: every pixel rebuilt from either projection reads the same shadow texel', () => {
  // The headers differ in a few words a camera — the round trip's residues where `W·P` holds an
  // exact zero, a last bit elsewhere —; the rebuilt positions, by one f32 step, in 3 of these
  // 262 144 samples (16 pixels by 4 depths a camera, near plane to 2¹⁷ times it, every clipmap
  // level), never across a texel.
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const { width, height } = camera(i)
    const old = header(roundTrip, width, height),
      fresh = header(now, width, height)
    const viewShift = old.subarray(64, 67)
    const light = { id: 'sun', direction: [37, 41, 43].map((b) => haltonSpan(i, b, -1, 1)) }
    const at = { view: cam.view, projection: now, perspective: cam.perspective === 1, eye: cam.eye }
    const clipmap = createVsmClipmap(new VsmCacheManager(), light, at, { width, height }, 0)
    for (let j = 1; j <= 16; j++) {
      const px = Math.floor(haltonSpan(i * 16 + j, 2, 0, width)),
        py = Math.floor(haltonSpan(i * 16 + j, 3, 0, height))
      for (let n = 1; n <= 4; n++) {
        const t = halton(i * 64 + j * 4 + n, 5),
          z = f(cam.perspective === 1 ? 2 ** (-t * 17) : t)
        const a = shifted(old, px, py, z),
          b = shifted(fresh, px, py, z)
        assert.equal(texel(clipmap, viewShift, a), texel(clipmap, viewShift, b), `camera ${i}`)
      }
    }
  }
})
