// The GPU frustum verdict (`verdictWgsl.ts`), its shipped text run in JavaScript (`shaderRun`),
// against its contract on adversarial scenes (`verdictScene.fixture.ts`), an eye far from the
// world's origin among them: it keeps every item the exact double test keeps
// (`verdict.fixture.ts`, the float64 oracle), and differs from it only on boxes within its rounding
// margin of a plane, a margin measured from the eye.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { hasBit } from '../../../../math/src/scalar/bits.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { gpuVerdict } from './verdictRun.fixture.ts'
import { orderBlendPasses } from './order.ts'
import { blendVerdictCpu } from './verdict.fixture.ts'
import { FLUSH, ROUNDING_GAMMA } from '../../../../math/src/float/guards.ts'
import { verdictScene } from './verdictScene.fixture.ts'

/** Whether the exact test's verdict on `box` may differ from the kernel's: a number the kernel
 *  leaves out of single precision, or a plane the box lies behind within twice its margin, both
 *  measured from `eye`. */
function marginal(planes: Float64Array, box: Float64Array, eye: number[]) {
  const bounded = (v: number) => Math.abs(v) < 2 ** 60
  if (!box.every(bounded) || !planes.every(bounded)) return true
  for (let p = 0; p < 24; p += 4) {
    const [a, b, c, w] = planes.subarray(p, p + 4)
    const x = (a > 0 ? box[3] : box[0]) - eye[0],
      y = (b > 0 ? box[4] : box[1]) - eye[1],
      z = (c > 0 ? box[5] : box[2]) - eye[2],
      d = a * eye[0] + b * eye[1] + c * eye[2] + w
    const s = a * x + b * y + c * z + d,
      m = Math.abs(a * x) + Math.abs(b * y) + Math.abs(c * z) + Math.abs(d),
      r = Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(x) + Math.abs(y) + Math.abs(z)
    if (s < 0 && s >= -2 * (ROUNDING_GAMMA * m + FLUSH * (1 + r))) return true
  }
  return false
}

function check(count: number, seed: number, edges: boolean, eye = [0, 0, 0]) {
  const { blendState, counts } = verdictScene(count, lcgRandom(seed), edges, eye)
  // The compaction's four words a paged rank, its instance count the second.
  const instances = counts.filter((_, word) => word % 4 === 1)
  const gpu = gpuVerdict(blendState, counts),
    exact = blendVerdictCpu(blendState, instances),
    at = `seed ${seed}, ${count} items`
  blendState.blendGpu.forEach((item, i) => {
    const kept = hasBit(gpu.keep, i)
    assert.ok(kept || !hasBit(exact.keep, i), `${at}: item ${i} culled, the exact test keeps it`)
    if (kept !== hasBit(exact.keep, i))
      assert.ok(
        marginal(blendState.blendPlanes, item.bounds!, eye),
        `${at}: item ${i} off the margin`,
      )
  })
  assert.ok(gpu.rejected <= exact.rejected, `${at}: no more rejected`)
  assert.ok(gpu.inView >= exact.inView, `${at}: no less in view`)
  exact.waterDraws.forEach((draws, rank) =>
    assert.ok(gpu.waterDraws[rank] >= draws, `${at}: water rank ${rank} drawn`),
  )
  // Words past the scene's are written by none: the keep words cover the items exactly.
  assert.equal(gpu.keep.length, exact.keep.length)
}

test('random scenes: every item the exact test keeps is kept, the rest only in the margin', () => {
  for (let seed = 1; seed <= 16; seed++) check(150, seed, false)
})

test('NaN, infinite and signed-zero boxes and planes, one-ulp straddles: never a visible cull', () => {
  for (let seed = 101; seed <= 124; seed++) check(150, seed, true)
})

test('an eye far from the origin: the same contract, the margin measured from the eye', () => {
  for (let seed = 201; seed <= 212; seed++)
    check(150, seed, seed % 2 === 0, [2 ** 20 + 0.375, -3 * 2 ** 18, 2 ** 21])
})

test('empty groups and the word edges', () => {
  for (const count of [1, 31, 32, 33, 63, 64, 65, 97]) check(count, 300 + count, true)
})

test('a box a rounding outside a plane is kept; one a unit outside is rejected', () => {
  const near = verdictScene(2, lcgRandom(7), false)
  const items = near.blendState.blendGpu
  // Six axis planes around the origin, the first `x ≤ 10`; no item paged.
  for (let p = 0; p < 6; p++) {
    const n = [0, 0, 0]
    n[p >> 1] = p & 1 ? 1 : -1
    near.blendState.blendPlanes.set([n[0], n[1], n[2], 10], p * 4)
  }
  near.blendState.drawsPacked.fill(NO_INDEX)
  const outside = [10 + 2 ** -30, 11]
  items.forEach((item, i) =>
    Object.assign(item, {
      hidden: false,
      transmissive: false,
      flags: 0,
      placement: { rows: { live: new Uint8Array([1]) }, index: 0 },
      bounds: new Float64Array([outside[i], 0, 0, outside[i] + 1, 1, 1]),
    }),
  )
  orderBlendPasses(near.blendState, [0, 0, 0])
  const gpu = gpuVerdict(near.blendState, [])
  assert.ok(hasBit(gpu.keep, 0), 'a box single precision cannot tell from the plane stays')
  assert.ok(!hasBit(gpu.keep, 1), 'a box well outside goes')
  assert.equal(gpu.rejected, 1)
})

test('beside an eye a million metres out, a box a millimetre outside a plane is rejected', () => {
  // Measured from the world's origin, the margin would reach metres there and keep it.
  const eye = [2 ** 20, 0, 2 ** 20]
  const far = verdictScene(2, lcgRandom(9), false, eye)
  for (let p = 0; p < 6; p++) {
    const n = [0, 0, 0]
    n[p >> 1] = p & 1 ? 1 : -1
    far.blendState.blendPlanes.set([n[0], n[1], n[2], 10 - n[0] * eye[0] - n[2] * eye[2]], p * 4)
  }
  far.blendState.drawsPacked.fill(NO_INDEX)
  const outside = [eye[0] + 10 + 2 ** -20, eye[0] + 10 + 2 ** -10]
  far.blendState.blendGpu.forEach((item, i) =>
    Object.assign(item, {
      hidden: false,
      transmissive: false,
      flags: 0,
      placement: { rows: { live: new Uint8Array([1]) }, index: 0 },
      bounds: new Float64Array([outside[i], 0, eye[2], outside[i] + 1, 1, eye[2] + 1]),
    }),
  )
  orderBlendPasses(far.blendState, eye)
  const gpu = gpuVerdict(far.blendState, [])
  assert.ok(hasBit(gpu.keep, 0), 'a micrometre out, within the rounding from the eye: kept')
  assert.ok(!hasBit(gpu.keep, 1), 'a millimetre out: rejected')
  assert.equal(gpu.rejected, 1)
})

test('an eye past the bound, infinite or NaN: no plane rejects, every drawn box is kept', () => {
  for (const x of [2 ** 61, Infinity, NaN]) {
    const scene = verdictScene(2, lcgRandom(11), false)
    for (let p = 0; p < 6; p++) {
      const n = [0, 0, 0]
      n[p >> 1] = p & 1 ? 1 : -1
      scene.blendState.blendPlanes.set([n[0], n[1], n[2], 10], p * 4)
    }
    scene.blendState.drawsPacked.fill(NO_INDEX)
    scene.blendState.blendGpu.forEach((item) =>
      Object.assign(item, {
        hidden: false,
        transmissive: false,
        flags: 0,
        placement: { rows: { live: new Uint8Array([1]) }, index: 0 },
        bounds: new Float64Array([11, 0, 0, 12, 1, 1]),
      }),
    )
    // The boxes lie a unit outside `x ≤ 10`: an eye at the origin rejects both.
    const eye = [x, 0, 0]
    orderBlendPasses(scene.blendState, eye)
    const gpu = gpuVerdict(scene.blendState, [])
    assert.ok(hasBit(gpu.keep, 0) && hasBit(gpu.keep, 1), `eye x = ${x}: both kept`)
    assert.equal(gpu.rejected, 0)
  }
})
