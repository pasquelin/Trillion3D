// The pdf of the half vector a reflection ray is drawn with, the pdf of the ray it gives, the cone that pdf gives the ray and the weight the
// reuse puts on a neighbour's ray (`reflectionHalfPdf`, `reflectionRayPdf`, `reflectionRayCone`, `reflectionRayWeight`, run in JavaScript by
// `shaderRun`), against the closed forms of the visible-normal distribution: the half vector's 2 (v·h) D(h) / (k n·v + |v̂|), k the bound of the
// cap, |v̂| the view stretched by the widths, the ray's that over 4 (v·h), the cone 4 (v·h) over the half vector's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { REFLECTION_RESOLVE_WGSL, REFLECTION_REUSE_WGSL } from './resolveWgsl.ts'
import { REFLECTION_SAMPLE_WGSL } from './sampleWgsl.ts'

type Vec3 = [number, number, number]
type Frame = { T: Vec3; B: Vec3 }
const run = shaderRun<{
  reflectionHalfPdf: (N: Vec3, V: Vec3, f: Frame, widths: number[], h: Vec3) => number
  reflectionRayPdf: (N: Vec3, V: Vec3, axis: Vec3, widths: number[], d: Vec3) => number
  reflectionRayCone: (N: Vec3, V: Vec3, axis: Vec3, widths: number[], d: Vec3) => number
  reflectionRayWeight: (
    N: Vec3,
    V: Vec3,
    f: Frame,
    widths: number[],
    L: Vec3,
    pdf: number,
  ) => number
  reflectionLobeDensity: (N: Vec3, f: Frame, widths: number[], h: Vec3) => number
  reflectionFrameOf: (N: Vec3, axis: Vec3) => Frame
}>(
  wgslModule(REFLECTION_REUSE_WGSL),
  [
    'reflectionHalfPdf',
    'reflectionRayPdf',
    'reflectionRayCone',
    'reflectionRayWeight',
    'reflectionLobeDensity',
    'reflectionFrameOf',
  ],
  {},
)

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a)
  return [a[0] / l, a[1] / l, a[2] / l]
}
const near = (a: number, b: number, what: string, relative = 2e-4) =>
  assert.ok(Math.abs(a - b) <= relative * Math.abs(b), `${what}: ${a} against ${b}`)

const N: Vec3 = [0, 0, 1]
/** The reference's distribution of the visible normals' half vector `h`, in the frame (x along the axis, y across, z the normal), for the
 *  widths `(ax, ay)`: the density `D`, the pdf `half` of the half vector, the pdf `pdf` of the ray along `d` it gives, that over 4 (v·h),
 *  and the cone `cone` of that ray, the inverse of its pdf before the floors, 4 (v·h) over the half vector's pdf. */
function expected(V: Vec3, d: Vec3, ax: number, ay: number) {
  const h = unit([V[0] + d[0], V[1] + d[1], V[2] + d[2]])
  const a2 = ax * ay
  const s = [ay * h[0], ax * h[1], a2 * h[2]]
  const S = dot(s, s)
  const D = (a2 * (a2 / S) ** 2) / Math.PI
  const a = Math.min(ax, ay)
  const wide = 1 + Math.hypot(V[0], V[1])
  const k = (wide ** 2 - a * a * wide ** 2) / (wide ** 2 + a * a * V[2] ** 2)
  const stretched = Math.hypot(V[0] * ax, V[1] * ay, V[2])
  const half = (2 * dot(V, h) * D) / (k * V[2] + stretched)
  return { D, half, pdf: half / (4 * dot(V, h)), cone: (4 * dot(V, h)) / half }
}

const V = unit([0.3, 0.1, 0.9])
/** A direction near the mirror of V about the normal `n`. */
const mirror = (n: Vec3): Vec3 => {
  const c = 2 * dot(V, n)
  return [c * n[0] - V[0], c * n[1] - V[1], c * n[2] - V[2]]
}

test('the pdf of a round lobe’s ray is that of the visible normals’ half vector over 4 (v·h), the half vector’s 2 (v·h) D / (k n·v + |v̂|)', () => {
  for (const [alpha, tilt] of [
    [0.04, [0.05, 0.02, 1]],
    [0.3, [-0.2, 0.1, 1]],
    [0.9, [0.1, -0.3, 1]],
  ] as const) {
    const h = unit([...tilt] as Vec3)
    const d = mirror(h)
    const f = run.reflectionFrameOf(N, [0, 0, 0])
    near(
      run.reflectionHalfPdf(N, V, f, [alpha, alpha], h),
      expected(V, d, alpha, alpha).half,
      `the half vector, α ${alpha}`,
    )
    near(
      run.reflectionRayPdf(N, V, [0, 0, 0], [alpha, alpha], d),
      expected(V, d, alpha, alpha).pdf,
      `the ray, α ${alpha}`,
    )
  }
})

// α 0.25 seen at n·v 0.7, the ray drawn with the half vector at the normal (v·h = 0.7): the half vector's pdf is 5.197, the ray's 5.197 / 2.8 = 1.856,
// so its cone is 0.539 radians, not the 0.192 the half vector's pdf gives — 4 (v·h) = 2.8 times as wide.
test('a ray’s cone is 4 (v·h) over its half vector’s pdf, not the inverse of that pdf: α 0.25 at n·v 0.7 gives 0.539, not 0.192', () => {
  const alpha = 0.25
  const Vn: Vec3 = [Math.sqrt(1 - 0.49), 0, 0.7]
  const f = run.reflectionFrameOf(N, [0, 0, 0])
  const d: Vec3 = [-Vn[0], 0, Vn[2]]
  const half = run.reflectionHalfPdf(N, Vn, f, [alpha, alpha], N)
  near(half, 5.197, 'the half vector’s pdf', 1e-3)
  const cone = run.reflectionRayCone(N, Vn, [0, 0, 0], [alpha, alpha], d)
  near(cone, 0.5387, 'the cone', 1e-3)
  near(cone, (4 * 0.7) / half, 'the cone against 4 (v·h) / the half vector’s pdf')
  assert.ok(cone > 2.7 / half, `not the half vector’s inverse ${1 / half}: ${cone}`)
})

// The ray drawn by the screen stage's own sampler (`reflectionSampleDirection`, a few blue-noise pairs), its cone from the pdf of the half vector it
// was mirrored about, against the reference's cone of that ray.
test('the cone of a ray the sampler draws is the reference’s: 4 (v·h) over the pdf of the half vector it drew', () => {
  const sample = shaderRun<{
    reflectionSampleDirection: (N: Vec3, V: Vec3, axis: Vec3, widths: number[], u: number[]) => Vec3
  }>(wgslModule(REFLECTION_SAMPLE_WGSL), ['reflectionSampleDirection'], {
    reflectionView: { lobe: [0, 0, 0, 0] },
  })
  const Vn = unit([0.6, 0.2, 0.7])
  for (const alpha of [0.06, 0.25, 0.6])
    for (const u of [
      [0.1, 0.2],
      [0.5, 0.5],
      [0.8, 0.3],
      [0.35, 0.9],
    ]) {
      const d = sample.reflectionSampleDirection(N, Vn, [0, 0, 0], [alpha, alpha], u)
      const { cone, pdf } = expected(Vn, d, alpha, alpha)
      near(run.reflectionRayPdf(N, Vn, [0, 0, 0], [alpha, alpha], d), pdf, `α ${alpha} pdf`)
      near(
        run.reflectionRayCone(N, Vn, [0, 0, 0], [alpha, alpha], d),
        Math.min(Math.max(cone, 1e-5), 1e4),
        `α ${alpha} at ${u}`,
        1e-3,
      )
    }
})

test('an anisotropic lobe’s pdf is laid on the frame of its axis: wide along it, narrow across', () => {
  const axis: Vec3 = [1, 0, 0]
  const d = mirror(unit([0.15, -0.05, 1]))
  near(
    run.reflectionRayPdf(N, V, axis, [0.4, 0.05], d),
    expected(V, d, 0.4, 0.05).pdf,
    'axis along x',
  )
  // The axis turned across: the widths swap with it.
  near(
    run.reflectionRayPdf(N, V, [0, 1, 0], [0.4, 0.05], d),
    expected([V[1], -V[0], V[2]], [d[1], -d[0], d[2]], 0.4, 0.05).pdf,
    'axis along y',
  )
})

test('a round lobe’s distribution is the isotropic GGX, and the weight of a ray is that over its pdf', () => {
  const f = run.reflectionFrameOf(N, [0, 0, 0])
  const alpha = 0.2
  const h = unit([0.1, 0.05, 1])
  const iso = (alpha * alpha) / (Math.PI * (1 - h[2] ** 2 + h[2] ** 2 * alpha * alpha) ** 2)
  near(run.reflectionLobeDensity(N, f, [alpha, alpha], h), iso, 'D')
  // The ray along L has the half vector (V + L)/|V + L|.
  const L = mirror(unit([0.1, 0.05, 1]))
  near(
    run.reflectionRayWeight(N, V, f, [alpha, alpha], L, 0.5),
    expected(V, L, alpha, alpha).D / 0.5,
    'weight',
  )
})

test('the cone of a ray is the inverse of its pdf, the pdf held above a ten-thousandth, the angle above a hundred-thousandth', () => {
  const d = mirror(unit([0.05, 0.02, 1]))
  const pdf = run.reflectionRayPdf(N, V, [0, 0, 0], [0.2, 0.2], d)
  near(run.reflectionRayCone(N, V, [0, 0, 0], [0.2, 0.2], d), 1 / pdf, 'the inverse')
  // A ray far in the tail of a narrow lobe: a pdf under the floor gives the cone of the floor, 10⁴.
  const tail = unit([0.9, 0, 0.1])
  near(run.reflectionRayCone(N, V, [0, 0, 0], [0.01, 0.01], tail), 1e4, 'the floor of the pdf')
  // A pdf past 10⁵ gives the least angle.
  near(run.reflectionRayCone(N, V, [0, 0, 0], [0.0005, 0.0005], mirror(N)), 1e-5, 'the least angle')
})

// The centre of a pixel no texel centred. The reference reads the ray of its centre at the pixel's flattened screen coordinate,
// which it moves to the nearest texel of the grid wherever the upsample found one; where none found one (the weights all under 0.01) it keeps
// the pixel's own coordinates, a full-image coordinate that indexes the grid, so the ray whose weight stands for the centre is that of an unrelated
// texel. The centre's lighting is zero there, so that weight only divides the neighbours' light.
test('a pixel no texel centred has a centre of weight 10⁻³, not the weight of an unrelated texel’s ray', () => {
  const resolve = shaderRun<{
    resolveCentreWeight: (
      centred: boolean,
      texel: number[],
      N: Vec3,
      V: Vec3,
      f: Frame,
      widths: number[],
    ) => number
  }>(wgslModule(REFLECTION_RESOLVE_WGSL), ['resolveCentreWeight'], {
    // The grid holds, at the pixel's nearest texel (2, 1), a ray along the mirror direction of pdf 2, and at the texel of the pixel's own
    // coordinates (4, 2) read as a grid coordinate, a ray along the mirror direction of pdf 0.5.
    reflectionRayAt: (g: number[]) => (g[0] === 2 ? [0, 0, 1, 0.5] : [0, 0, 1, 2]),
  })
  const alpha = 0.25
  const f = run.reflectionFrameOf(N, [0, 0, 0])
  const density = 1 / (Math.PI * alpha * alpha)
  // The mirror ray of pdf 2 over a lobe of α = 0.25: D(h = n) / pdf, D = 1 / (π α²).
  near(
    resolve.resolveCentreWeight(true, [2, 1], N, N, f, [alpha, alpha]),
    density / 2,
    'the nearest texel’s ray',
  )
  const ours = resolve.resolveCentreWeight(false, [4, 2], N, N, f, [alpha, alpha])
  assert.equal(ours, 1e-3)
  // The reference's weight for the same pixel: the ray at (4, 2), pdf 0.5, so D / 0.5 = 10.19, at least 10⁻³.
  const reference = Math.max(density / 0.5, 1e-3)
  near(reference, 10.186, 'the reference’s unrelated texel')
  // The neighbours weigh 0.5 together and the centre's lighting is zero: the share of their light the pixel keeps is they / (centre + they).
  const kept = (centre: number) => 0.5 / (centre + 0.5)
  assert.ok(kept(ours) > 0.998, `ours keeps the neighbours’ light: ${kept(ours)}`)
  assert.ok(
    kept(reference) < 0.05,
    `the reference’s formula darkens it elevenfold: ${kept(reference)}`,
  )
})

test('a neighbour of the reconstruction is the pixel plus the disc’s offset and a half, cut toward zero: the reference’s (int2)(coord + offset + 0.5)', () => {
  const text = wgslModule(REFLECTION_RESOLVE_WGSL)
  assert.ok(
    text.includes('let n=vec2i(vec2f(coord)+tap.x*major+tap.y*minor+vec2f(0.5));'),
    'the neighbour',
  )
})
