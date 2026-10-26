// The clear coat (`clearCoatWgsl.ts`) against the reference's clear coat shading model, transcribed here
// in double precision step for step (ClearCoatBxDF, RefractClearCoatContext, SimpleClearCoatTransmittance,
// RemapClearCoatDiffuseAndSpecularColor): a light of no size on the plain pixel, a bottom normal, a metal base
// (which the coat's transmittance colours), an anisotropic base; the remap of the indirect light's colours.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { LOBES_LIGHTING_WGSL } from './lobesWgsl.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { unitF32 } from '../../../../math/src/vector/unitF32.fixture.ts'

type V3 = number[]
type Fn = (...args: unknown[]) => any
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: V3) => a.map((x) => x / Math.hypot(...a))
const sat = (x: number) => Math.min(Math.max(x, 0), 1)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const pow5 = (x: number) => x ** 5

interface Ctx {
  NoL: number
  NoV: number
  NoH: number
  VoL: number
  VoH: number
  XoV: number
  XoL: number
  XoH: number
  YoV: number
  YoL: number
  YoH: number
}
function init(N: V3, V: V3, L: V3, X: V3 = [0, 0, 0], Y: V3 = [0, 0, 0]): Ctx {
  const NoL = dot(N, L),
    NoV = dot(N, V),
    VoL = dot(V, L),
    inv = 1 / Math.sqrt(2 + 2 * VoL)
  const XoV = dot(X, V),
    XoL = dot(X, L),
    YoV = dot(Y, V),
    YoL = dot(Y, L)
  return {
    NoL,
    NoV,
    VoL,
    NoH: sat((NoL + NoV) * inv),
    VoH: sat(inv + inv * VoL),
    XoV,
    XoL,
    XoH: (XoL + XoV) * inv,
    YoV,
    YoL,
    YoH: (YoL + YoV) * inv,
  }
}
function refract(c: Ctx): Ctx {
  const eta = 1 / 1.5,
    blend = (0.63 - 0.22 * c.VoH) * c.VoH - 0.745,
    projection = blend * c.NoH
  const VoH = sat(eta * c.VoH - blend)
  return {
    ...c,
    NoV: Math.min(Math.max(eta * c.NoV - projection, 0.001), 1),
    NoL: Math.min(Math.max(eta * c.NoL - projection, 0.001), 1),
    VoH,
    VoL: 2 * VoH * VoH - 1,
  }
}
function transmittance(NoL: number, NoV: number, metal: number, base: V3) {
  if (!(metal > 0)) return [1, 1, 1]
  const thin = 1 / NoV + 1 / NoL
  return base.map((b) => {
    const colour = b / Math.PI,
      extinction = -Math.log(Math.max(colour, 0.0001)) / 2
    return mix(1, Math.exp(-extinction * Math.max(thin - 2, 0)), metal)
  })
}
const dGgx = (a2: number, NoH: number) => a2 / (Math.PI * ((NoH * a2 - NoH) * NoH + 1) ** 2)
const visApprox = (a2: number, NoV: number, NoL: number) => {
  const a = Math.sqrt(a2)
  return 0.5 / (NoL * (NoV * (1 - a) + a) + NoV * (NoL * (1 - a) + a))
}
const fSchlick = (f0: V3, VoH: number) =>
  f0.map((f) => sat(50 * f0[1]) * pow5(1 - VoH) + (1 - pow5(1 - VoH)) * f)

interface Pixel {
  N: V3
  V: V3
  rough: number
  base: V3
  metal: number
  specular: number
  coat: number
  coatRough: number
  coatN: V3
  bottomNormal: boolean
  skew?: { T: V3; at: number; ab: number }
}
/** ClearCoatBxDF for a light of no size: `[diffuse, specular]`, energy `falloff`, no colour. */
function reference(p: Pixel, L: V3, falloff: number) {
  const { N, V, rough, base, metal, coat: c, coatN: Nspec } = p
  const cr = Math.max(p.coatRough, 0.02),
    alpha = rough * rough,
    NoLArea = sat(dot(N, L))
  const specularColor = base.map((b) => mix(0.08 * p.specular, b, metal))
  const diffuseColor = base.map((b) => b * (1 - metal))
  let ctx = init(Nspec, V, L)
  ctx.NoV = sat(Math.abs(ctx.NoV) + 1e-5)
  const Fc = pow5(1 - ctx.VoH),
    F = Fc + (1 - Fc) * 0.04
  const ac2 = (cr * cr) ** 2
  const top = c * falloff * NoLArea * dGgx(ac2, ctx.NoH) * visApprox(ac2, ctx.NoV, NoLArea) * F
  const fresnel = (1 - F) * (1 - F)
  if (p.bottomNormal) {
    const H = unit([V[0] + L[0], V[1] + L[1], V[2] + L[2]])
    ctx = {
      ...ctx,
      NoH: sat(dot(N, H)),
      NoV: sat(dot(N, V)),
      NoL: sat(dot(N, L)),
      VoL: sat(dot(V, L)),
      VoH: sat(dot(V, H)),
    }
    ctx.NoV = sat(Math.abs(ctx.NoV) + 1e-5)
  }
  if (p.skew) {
    const X = p.skew.T,
      Y = cross(N, X)
    ctx = init(Nspec, V, L, X, Y)
  }
  const bottom = refract(ctx)
  const T = transmittance(bottom.NoL, bottom.NoV, metal, base)
  const plain = diffuseColor.map((d) => (falloff * NoLArea * d) / Math.PI)
  const diffuse = plain.map((d, i) => mix(d, fresnel * T[i] * d, c))
  let D2: number, vis2: number
  if (p.skew) {
    const { at: ax, ab: ay } = p.skew,
      a2 = ax * ay,
      v = [ay * ctx.XoH, ax * ctx.YoH, a2 * ctx.NoH],
      S = dot(v, v)
    D2 = (1 / Math.PI) * a2 * (a2 / S) ** 2
    const vV = bottom.NoL * Math.hypot(ax * bottom.XoV, ay * bottom.YoV, bottom.NoV),
      vL = bottom.NoV * Math.hypot(ax * bottom.XoL, ay * bottom.YoL, bottom.NoL)
    vis2 = 0.5 / (vV + vL)
  } else {
    const a2 = alpha * alpha
    D2 = dGgx(a2, bottom.NoH)
    vis2 = visApprox(a2, bottom.NoV, NoLArea)
  }
  const fBottom = fSchlick(specularColor, bottom.VoH),
    fPlain = fSchlick(specularColor, ctx.VoH)
  const common = falloff * NoLArea * D2 * vis2
  const specular = fPlain.map((f, i) => top + common * mix(f, fresnel * T[i] * fBottom[i], c))
  void alpha
  return [diffuse, specular]
}

const program = wgslModule(STANDARD_LIGHTING_WGSL, LOBES_LIGHTING_WGSL)
const NAMES = ['lobeSurface', 'coatedPoint', 'coatRemap']
function lobesOf(p: Pixel) {
  const alpha = p.rough * p.rough
  const skew = p.skew
  const T = skew ? p.skew!.T : [0, 0, 0],
    B = skew ? cross(p.N, T) : [0, 0, 0]
  const at = skew ? skew.at : alpha,
    ab = skew ? skew.ab : alpha
  return {
    on: true,
    skewed: !!skew,
    cloth: 0,
    T,
    B,
    coat: p.coat,
    coatRough: p.coatRough,
    coatN: p.coatN,
    coatNoV: sat(dot(p.coatN, p.V)),
    coatAlpha: Math.fround(Math.max(p.coatRough, 0.02) ** 2),
    baseColour: p.base,
    extinction: p.base.map((c) => Math.fround(-Math.log(Math.max(c / Math.PI, 0.0001)) / 2)),
    metal: p.metal,
    baseRough: p.rough,
    at,
    ab,
  }
}
function run(p: Pixel, lobes = lobesOf(p)) {
  return shaderRun<Record<string, Fn>>(program, NAMES, {
    ...F32_SCOPE,
    pixelModel: 0,
    sphereNoNewton: false,
    clearCoatBottom: p.bottomNormal,
    surfaceSpecular: p.specular,
    lobes,
  })
}
function pixelOf(r: () => number, round: number): Pixel {
  const u = (lo: number, hi: number) => lerp(lo, hi, r())
  const N = unitF32([u(-0.5, 0.5), u(-0.5, 0.5), 1]),
    V = unitF32([u(-0.8, 0.8), u(-0.8, 0.8), u(0.3, 1)])
  const bottomNormal = round % 4 >= 2
  const coatN = bottomNormal ? unitF32(N.map((n) => n + u(-0.2, 0.2))) : N
  const T = unitF32(cross(N, [0, 1, 0]))
  return {
    N,
    V,
    rough: u(0.15, 1),
    base: [u(0.05, 1), u(0.05, 1), u(0.05, 1)],
    metal: round % 3 === 0 ? 1 : round % 3 === 1 ? 0 : u(0, 1),
    specular: 0.5,
    coat: u(0.1, 1),
    coatRough: u(0.03, 0.6),
    coatN,
    bottomNormal,
    skew: round % 5 === 0 ? { T, at: u(0.1, 0.5), ab: u(0.05, 0.3) } : undefined,
  }
}
const close = (got: number[], want: number[], what: string) =>
  want.forEach((w, i) =>
    assert.ok(
      Math.abs(got[i] - w) <= 4e-3 * Math.max(Math.abs(w), 1e-3) + 1e-5,
      `${what}: ${got} against ${want}`,
    ),
  )

test('a light of no size on a clear coat: the diffuse and the specular of the reference model', () => {
  const r = lcgRandom(2025)
  let lit = 0
  for (let round = 0; round < 240; round++) {
    const p = pixelOf(r, round)
    const L = unitF32([lerp(-0.7, 0.7, r()), lerp(-0.7, 0.7, r()), lerp(0.2, 1, r())])
    const energy = lerp(1, 10, r())
    const ran = run(p)
    const surface = ran.lobeSurface(p.base, p.metal, p.rough, p.N, p.V)
    const got = ran.coatedPoint(surface, p.N, p.V, L, energy) as number[][]
    const want = reference(p, L, energy)
    close(got[0], want[0], `round ${round} diffuse`)
    close(got[1], want[1], `round ${round} specular`)
    if (want[1].some((x) => x > 0)) lit++
  }
  assert.ok(lit > 200, `${lit} lit`)
})

test('a coat of weight zero is the plain lobes: the diffuse as the surface has it', () => {
  const r = lcgRandom(7)
  for (let round = 0; round < 40; round++) {
    const p = { ...pixelOf(r, round), coat: 0, skew: undefined }
    const L = unitF32([0.3, 0.2, 0.9])
    const ran = run(p)
    const surface = ran.lobeSurface(p.base, p.metal, p.rough, p.N, p.V)
    const got = ran.coatedPoint(surface, p.N, p.V, L, 2) as number[][]
    const d = (surface.diffuse as number[]).map((x) => x * 2 * Math.max(dot(p.N, L), 0))
    close(got[0], d, `round ${round}`)
  }
})

test('the indirect light sees the base through the coat: the reference’s remap of its colours', () => {
  const r = lcgRandom(99)
  for (let round = 0; round < 60; round++) {
    const p = pixelOf(r, round)
    const ran = run(p)
    const got = ran.coatRemap(p.base, p.metal) as { diffuse: number[]; specular: number[] }
    const NoV = sat(dot(p.coatN, p.V)),
      refraction = ((NoV * 0.5 + 0.5) * NoV - 1) * sat(1.25 - 1.25 * p.rough) + 1
    const F = pow5(1 - NoV) + (1 - pow5(1 - NoV)) * 0.04,
      attenuation = mix(1, 1 - F, p.coat)
    const colour = p.base.map((b) => {
      const a = b / 0.9,
        absorption = a * ((NoV - 1) * 0.85 * (1 - mix(a, a * a, -0.78)) + 1)
      return mix(b * attenuation, 0.9 * absorption * refraction, p.metal * p.coat)
    })
    close(
      got.diffuse,
      colour.map((b) => b - b * p.metal),
      `round ${round} diffuse`,
    )
    const spec = mix(p.specular, refraction, p.coat)
    close(
      got.specular,
      colour.map((b) => mix(0.08 * spec, b, p.metal)),
      `round ${round} specular`,
    )
  }
})
