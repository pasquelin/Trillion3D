// A lobed pixel's light (`lobeLight`, `lobesWgsl.ts`) tests the base's and the coat's facing before
// it pays the half-vector, as `surfaceLight` does: a light behind both returns its zero before
// `H`, the coat's facing is read only under a coat. The same operations in the same order on every
// light that reaches the pixel: run in f32 (`shaderRun`, `F32_SCOPE`) beside the order it replaced,
// on random lights, in front and behind, lobes with and without strength and coat, the sums are the
// same numbers, bit for bit. Its anisotropic lobe reads T·H/αt and B·H/αb as products by the
// reciprocals `setLobes` takes once a pixel, and its distribution 1/(π αt αb q²) as the pixel's
// 1/(π αt αb) over q²: beside the two divides and the whole denominator, on lit anisotropic pixels
// down to grazing views and the roughness floor, the same 8-bit image under every exposure and
// curve.
import test from 'node:test'
import assert from 'node:assert/strict'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { PI, ROUGHNESS_FLOOR } from '../shaderConstants.ts'
import { LOBES_LIGHTING_WGSL } from './lobesWgsl.ts'

type Light = (...args: unknown[]) => number[]
const NAMES = [
  'lobeLight',
  'anisotropicLobe',
  ...[...STANDARD_LIGHTING_WGSL.matchAll(/fn (\w+)\(/g)].map(([, name]) => name),
]
const shipped = `${STANDARD_LIGHTING_WGSL}\n${LOBES_LIGHTING_WGSL}`
/** The order it replaced: the half-vector and the coat's facing first, whatever faces. */
const before = shipped.replace(
  /(surfaceLight\(s,N,V,light\);\}\n let L=normalize\(light\.xyz\);)[\s\S]*?(var base=vec3f\(0\.0\);)/,
  `$1let H=normalize(L+V);
 var coat=vec3f(0.0);
 let coatNdotL=max(dot(lobes.coatN,L),0.0);
 if(lobes.coat>0.0&&coatNdotL>0.0){coat=lobes.coat*standardLobe(lobes.coatSurface,lobes.coatN,V,H,coatNdotL,light.w);}
 let NdotL=max(dot(N,L),0.0);
 $2`,
)

test('a lobed light pays the half-vector only where the base or the coat faces it, bit for bit', () => {
  assert.notEqual(before, shipped)
  const r = random(1483),
    u = (lo: number, hi: number) => Math.fround(lo + (hi - lo) * r())
  const unit = (v: number[]) => v.map((x) => Math.fround(x / Math.hypot(...v)))
  // What a pixel's lights share of a surface, as the shipped loop takes it (`lobeSurface`).
  const { lobeSurface } = shaderRun<Record<string, Light>>(shipped, NAMES, F32_SCOPE)
  let zeros = 0,
    lit = 0
  for (let round = 0; round < 400; round++) {
    const N = unit([u(-1, 1), u(-1, 1), u(0.2, 1)])
    const V = unit([u(-1, 1), u(-1, 1), u(0, 1)])
    const coat = [0, 0, 1, u(0.1, 1)][round % 4]
    const strength = [0, 0.7][Math.floor(round / 4) % 2]
    const T = unit([N[1], -N[0], 0])
    const coatRough = u(0.05, 1),
      coatN = unit([u(-1, 1), u(-1, 1), u(-1, 1)])
    const at = u(0.05, 1),
      ab = u(0.05, 1)
    const lobes = {
      on: true,
      strength,
      T,
      B: [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]],
      coat,
      coatRough,
      coatN,
      through: u(0.5, 1),
      at,
      ab,
      invAt: Math.fround(1 / at),
      invAb: Math.fround(1 / ab),
      dScale: Math.fround(1 / Math.fround(Math.fround(Math.fround(Number(PI)) * at) * ab)),
      viewLength: u(0.05, 1),
      coatSurface: lobeSurface([0, 0, 0], 0, coatRough, coatN, V),
    }
    const surface = lobeSurface([u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1), N, V)
    const args = [surface, N, V, [u(-1, 1), u(-1, 1), u(-1, 1), u(0, 20)]]
    const run = (text: string) =>
      shaderRun<Record<string, Light>>(text, NAMES, { ...F32_SCOPE, lobes }).lobeLight(...args)
    const ours = run(shipped),
      theirs = run(before)
    assert.ok(
      ours.every((v, i) => Object.is(v, theirs[i])),
      `round ${round}: ${ours} against ${theirs}`,
    )
    if (theirs.every((v) => v === 0)) zeros++
    else lit++
  }
  // Both outcomes are met: lights behind the base and the coat, and lights that reach the pixel.
  assert.ok(zeros > 40 && lit > 40, `${zeros} zeros, ${lit} lit`)
})

const f = Math.fround
const fdot = F32_SCOPE.dot as (a: number[], b: number[]) => number
const fcross = F32_SCOPE.cross as (a: number[], b: number[]) => number[]
const flength = F32_SCOPE.length as (v: number[]) => number
const srgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
/** A lit colour as 8-bit display bytes: three exposures, each clipped and through `c / (1 + c)`. */
const bytes = (rgb: number[]) =>
  [0.25, 1, 4].flatMap((exposure) =>
    [(c: number) => Math.min(c, 1), (c: number) => c / (1 + c)].flatMap((curve) =>
      rgb.map((c) => Math.round(255 * srgb(curve(Math.max(c * exposure, 0))))),
    ),
  )

test('an anisotropic light reads its pixel reciprocals and scale: the same 8-bit image', () => {
  // The lobe as it divided: T·H by αt, B·H by αb, one over the whole denominator.
  const forms = [
    ['dot(T,H)*lobes.invAt,dot(B,H)*lobes.invAb', 'dot(T,H)/at,dot(B,H)/ab'],
    ['let D=lobes.dScale/(q*q);', `let D=1.0/(${PI}*at*ab*q*q);`],
  ]
  const divides = forms.reduce((text, [shippedForm, dividedForm]) => {
    assert.ok(text.includes(shippedForm), shippedForm)
    return text.replace(shippedForm, dividedForm)
  }, shipped)
  const r = random(1484),
    u = (lo: number, hi: number) => f(lo + (hi - lo) * r())
  const unit = (v: number[]) => v.map((x) => f(x / Math.hypot(...v)))
  const lobes: Record<string, unknown> = {}
  const ours = shaderRun<Record<string, Light>>(shipped, NAMES, { ...F32_SCOPE, lobes })
  const theirs = shaderRun<Record<string, Light>>(divides, NAMES, { ...F32_SCOPE, lobes })
  const floor = f(Number(ROUGHNESS_FLOOR)),
    pi = f(Number(PI))
  let lit = 0,
    moved = 0
  for (let round = 0; round < 4000; round++) {
    const N = unit([u(-1, 1), u(-1, 1), u(0.2, 1)])
    const T = unit(fcross(N, Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
    const B = fcross(N, T)
    // Every other pixel seen at grazing, N·V down to 1e-3; the others from anywhere in front.
    const across = [u(-1, 1), u(-1, 1)],
      lift = round % 2 ? u(0.001, 0.2) : u(0.2, 1)
    const V = unit(N.map((n, i) => n * lift + T[i] * across[0] + B[i] * across[1]))
    // A third of the pixels at the roughness floor, the narrowest lobe.
    const rough = round % 3 ? u(Number(ROUGHNESS_FLOOR), 1) : floor
    const strength = u(0.05, 1),
      coat = round % 5 ? 0 : u(0.1, 1),
      coatRough = u(0.05, 1),
      coatN = unit(N.map((n) => n + u(-0.2, 0.2)))
    const alpha = f(rough * rough),
      at = f(alpha + f(f(1 - alpha) * f(strength * strength)))
    const facing = f(Math.max(fdot(N, V), f(1e-4)))
    Object.assign(lobes, {
      on: true,
      strength,
      T,
      B,
      coat,
      coatRough,
      coatN,
      through: coat > 0 ? u(0.5, 1) : 1,
      at,
      ab: alpha,
      invAt: f(1 / at),
      invAb: f(1 / alpha),
      dScale: f(1 / f(f(pi * at) * alpha)),
      viewLength: flength([f(at * fdot(T, V)), f(alpha * fdot(B, V)), facing]),
      coatSurface: ours.lobeSurface([0, 0, 0], 0, coatRough, coatN, V),
    })
    const surface = ours.lobeSurface([u(0, 1), u(0, 1), u(0, 1)], u(0, 1), rough, N, V)
    const toward = unit([u(-1, 1), u(-1, 1), u(-1, 1)]),
      L = fdot(N, toward) < 0 ? toward.map((x) => -x) : toward
    const args = [surface, N, V, [...L, u(0.1, 20)]]
    const a = ours.lobeLight(...args),
      b = theirs.lobeLight(...args)
    if (a.some((v) => v !== 0)) lit++
    if (!a.every((v, i) => Object.is(v, b[i]))) moved++
    assert.deepEqual(bytes(a), bytes(b), `round ${round}: ${a} against ${b}`)
  }
  // The sweep lights its pixels: nearly every light faces the base it is drawn in front of.
  assert.ok(lit > 3600, `${lit} lit, ${moved} with other floats`)
})
