// Class 1 for the shadow projection's screen ray (`vsmScreenRayCast`, `projectionWgsl.ts`) under
// the projection `vsmProject.ts` uploads (`vsmProject.test.ts`): the march reads shiftedToClip
// (header words 0-15), which the old round trip `J(P·V)·V⁻¹` and `taaRenderProjection` write
// apart — a last bit, or the round trip's residue where `W·P` holds an exact zero. Emulated in
// f32 on `HALTON_SWEEP` cameras of an open world, temporal accumulation on and off, from the sun
// along the pixel's ray: the start and the four samples read the same depth texels and carry the
// same depths. The only change is the start's own, where the rebuilt point moved one f32 step
// (`vsmProjectTexel.test.ts`): counted, its depths bounded.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_SCREEN_RAY_SHARE } from '../../../../vsm/constants.ts'
import { halton } from '../../../../../../math/src/sequence/halton.ts'
import { f, sweptSamples, transform, viewDepth } from './vsmProject.fixture.ts'

/** `vsmScreenRayCast`'s reads from `origin` along `direction` for `length`, under header `h` of a
 *  `width` × `height` depth buffer, in f32: the five depth texels it loads and the four depths it
 *  tests them against. */
function march(
  h: Float32Array,
  origin: number[],
  direction: number[],
  length: number,
  dither: number,
  width: number,
  height: number,
) {
  const toClip = h.subarray(0, 16)
  const start = transform(toClip, origin[0], origin[1], origin[2], 1)
  const step = transform(
    toClip,
    f(direction[0] * length),
    f(direction[1] * length),
    f(direction[2] * length),
    0,
  )
  const startNdc = [0, 1, 2].map((k) => f(start[k] / start[3]))
  const end = start.map((x, k) => f(x + step[k])),
    stepNdc = [0, 1, 2].map((k) => f(f(end[k] / end[3]) - startNdc[k]))
  const uvz = [f(f(startNdc[0] * h[96]) + h[99]), f(f(startNdc[1] * h[97]) + h[98]), startNdc[2]],
    uvzStep = [f(stepNdc[0] * h[96]), f(stepNdc[1] * h[97]), stepNdc[2]]
  const at = (u: number, v: number) => {
    const x = Math.min(Math.max(Math.floor(f(u * width)), 0), width - 1),
      y = Math.min(Math.max(Math.floor(f(v * height)), 0), height - 1)
    return `${x},${y}`
  }
  const texels = [at(uvz[0], uvz[1])],
    depths: number[] = []
  let time = f(f(f(dither - 0.5) * 0.25) + 0.25)
  for (let i = 0; i < 4; i++, time = f(time + 0.25)) {
    const p = uvz.map((x, k) => f(x + f(uvzStep[k] * time)))
    texels.push(at(p[0], p[1]))
    depths.push(p[2])
  }
  return { texels: texels.join(' '), depths }
}

/** The f32 steps between `a` and `b`. */
function f32Steps(a: number, b: number) {
  const bits = new Int32Array(new Float32Array([a, b]).buffer)
  return Math.abs(bits[0] - bits[1])
}

test('class 1: the screen ray reads the same depth texels at the same depths from either header', () => {
  // Measured: 5 of 524 288 rays start from a rebuilt point one f32 step apart; their reads are
  // the same texels, their depths at most 2 f32 steps apart (2·10⁻⁷ of the depth).
  let moved = 0,
    widest = 0
  for (const { width, height, old, fresh, sun, z, key, point, own, at } of sweptSamples()) {
    // `screenRayWorld`: the screen ray scale's words (84-87), the same in both headers.
    const depth = viewDepth(fresh, z),
      length = f(f(fresh[85] * f(f(VSM_SCREEN_RAY_SHARE) * depth)) + fresh[87]),
      dither = f(halton(key, 7))
    const ray = march(fresh, point, sun, length, dither, width, height)
    // From the same start, the old header's shiftedToClip changes no read and no depth.
    const same = march(old, point, sun, length, dither, width, height)
    assert.equal(same.texels, ray.texels, at)
    same.depths.forEach((d, k) => assert.ok(Object.is(d, ray.depths[k]), at))
    // From each header's own rebuilt point: the same texels; the depths of a moved start.
    const before = march(old, own, sun, length, dither, width, height)
    assert.equal(before.texels, ray.texels, at)
    if (own.every((x, k) => x === point[k])) continue
    moved++
    before.depths.forEach((d, k) => (widest = Math.max(widest, f32Steps(d, ray.depths[k]))))
  }
  assert.equal(moved, 5)
  assert.ok(widest <= 2, `${widest} f32 steps`)
})
