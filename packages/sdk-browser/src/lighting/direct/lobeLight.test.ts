// A lobed pixel's light (`surfaceLight` through the lobe hooks, `lobesWgsl.ts`) tests the base's facing before it pays
// the half-vector: a light behind it returns its zero before `H`. The same operations in the same order on every
// light that reaches the pixel: run in f32 (`shaderRun`, `F32_SCOPE`) beside the order it replaced, on random lights,
// in front and behind, lobes with and without strength, the sums are the same numbers, bit for bit. Its anisotropic
// lobe reads T·H/αt and B·H/αb as products by the reciprocals `setLobes` takes once a pixel, and its distribution
// 1/(π αt αb q²) as the pixel's 1/(π αt αb) over q²: beside the two divides and the whole denominator, on lit
// anisotropic pixels down to grazing views and the roughness floor, the same 8-bit image under every exposure and
// curve.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { ROUGHNESS_FLOOR } from '../shaderConstants.ts'
import { LOBES_LIGHTING_WGSL } from './lobesWgsl.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { unitF32 } from '../../../../math/src/vector/unitF32.fixture.ts'
import { linearToSrgb8 } from '../../../../math/src/color/color.ts'

type Light = (...args: unknown[]) => number[]
// The scope of the runs: f32, no shading model set.
const SCOPE = { ...F32_SCOPE, pixelModel: 0, sphereNoNewton: false, clearCoatBottom: false }
const NAMES = ['lobeSurface', 'surfaceLight'],
  shipped = wgslModule(STANDARD_LIGHTING_WGSL, LOBES_LIGHTING_WGSL)
/** The order it replaced: the half-vector first, whatever faces. */
const before = shipped.replace(
  /(light:vec4f\)->vec3f\{\n let L=light\.xyz;)[\s\S]*?( return baseLobe)/,
  `$1
 let H=normalize(L+V);
 let NdotL=max(dot(N,L),0.0);
$2`,
)

test('a lobed light pays the half-vector only where the base faces it, bit for bit', () => {
  assert.notEqual(before, shipped)
  const r = lcgRandom(1483),
    u = (lo: number, hi: number) => Math.fround(lerp(lo, hi, r()))
  // What a pixel's lights share of a surface, as the shipped loop takes it (`lobeSurface`).
  const { lobeSurface } = shaderRun<Record<string, Light>>(shipped, NAMES, SCOPE)
  let zeros = 0,
    lit = 0
  for (let round = 0; round < 400; round++) {
    const N = unitF32([u(-1, 1), u(-1, 1), u(0.2, 1)])
    const V = unitF32([u(-1, 1), u(-1, 1), u(0, 1)])
    const strength = [0, 0.7][round % 2]
    const T = unitF32([N[1], -N[0], 0])
    const at = u(0.05, 1),
      ab = u(0.05, 1)
    const lobes = {
      on: true,
      skewed: strength > 0,
      T,
      B: [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]],
      coat: 0,
      at,
      ab,
      invAt: Math.fround(1 / at),
      invAb: Math.fround(1 / ab),
      dScale: Math.fround(1 / Math.fround(Math.fround(Math.fround(Math.PI) * at) * ab)),
      viewLength: u(0.05, 1),
    }
    const surface = lobeSurface([u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1), N, V)
    // The light's direction unit, as every caller hands it (`lampSeen`).
    const args = [surface, N, V, [...unitF32([u(-1, 1), u(-1, 1), u(-1, 1)]), u(0, 20)]]
    const run = (text: string) =>
      shaderRun<Record<string, Light>>(text, NAMES, { ...SCOPE, lobes }).surfaceLight(...args)
    const ours = run(shipped),
      theirs = run(before)
    assert.ok(
      ours.every((v, i) => Object.is(v, theirs[i])),
      `round ${round}: ${ours} against ${theirs}`,
    )
    if (theirs.every((v) => v === 0)) zeros++
    else lit++
  }
  // Both outcomes are met: lights behind the base, and lights that reach the pixel.
  assert.ok(zeros > 40 && lit > 40, `${zeros} zeros, ${lit} lit`)
})
const fdot = F32_SCOPE.dot as (a: number[], b: number[]) => number
const fcross = F32_SCOPE.cross as (a: number[], b: number[]) => number[]
const flength = F32_SCOPE.length as (v: number[]) => number
/** A lit colour as 8-bit display bytes: three exposures, each clipped and through `c / (1 + c)`. */
const bytes = (rgb: number[]) =>
  [0.25, 1, 4].flatMap((exposure) =>
    [(c: number) => Math.min(c, 1), (c: number) => c / (1 + c)].flatMap((curve) =>
      rgb.map((c) => linearToSrgb8(curve(Math.max(c * exposure, 0)))),
    ),
  )

test('an anisotropic light reads its pixel reciprocals and scale: the same 8-bit image', () => {
  // The lobe as it divided: T·H by αt, B·H by αb, one over the whole denominator.
  const forms = [
    ['dot(T,H)*lobes.invAt,dot(B,H)*lobes.invAb', 'dot(T,H)/at,dot(B,H)/ab'],
    ['let D=lobes.dScale/(q*q);', 'let D=1.0/(PI*at*ab*q*q);'],
  ]
  const divides = forms.reduce((text, [shippedForm, dividedForm]) => {
    assert.ok(text.includes(shippedForm), shippedForm)
    return text.replace(shippedForm, dividedForm)
  }, shipped)
  const r = lcgRandom(1484),
    u = (lo: number, hi: number) => Math.fround(lerp(lo, hi, r()))
  const lobes: Record<string, unknown> = {}
  const ours = shaderRun<Record<string, Light>>(shipped, NAMES, { ...SCOPE, lobes })
  const theirs = shaderRun<Record<string, Light>>(divides, NAMES, { ...SCOPE, lobes })
  const floor = Math.fround(ROUGHNESS_FLOOR),
    pi = Math.fround(Math.PI)
  let lit = 0,
    moved = 0
  for (let round = 0; round < 4000; round++) {
    const N = unitF32([u(-1, 1), u(-1, 1), u(0.2, 1)])
    const T = unitF32(fcross(N, Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
    const B = fcross(N, T)
    // Every other pixel seen at grazing, N·V down to 1e-3; the others from anywhere in front.
    const across = [u(-1, 1), u(-1, 1)],
      lift = round % 2 ? u(0.001, 0.2) : u(0.2, 1)
    const V = unitF32(N.map((n, i) => n * lift + T[i] * across[0] + B[i] * across[1]))
    // A third of the pixels at the roughness floor, the narrowest lobe.
    const rough = round % 3 ? u(ROUGHNESS_FLOOR, 1) : floor
    const strength = u(0.05, 1)
    // The one anisotropy law's widths: α(1 + s) along the axis, α(1 − s) across, each above 0.001.
    const alpha = Math.fround(rough * rough),
      at = Math.max(Math.fround(alpha * Math.fround(1 + strength)), Math.fround(0.001)),
      ab = Math.max(Math.fround(alpha * Math.fround(1 - strength)), Math.fround(0.001))
    const facing = Math.fround(Math.max(fdot(N, V), Math.fround(1e-4)))
    Object.assign(lobes, {
      on: true,
      skewed: true,
      T,
      B,
      coat: 0,
      at,
      ab,
      invAt: Math.fround(1 / at),
      invAb: Math.fround(1 / ab),
      dScale: Math.fround(1 / Math.fround(Math.fround(pi * at) * ab)),
      viewLength: flength([Math.fround(at * fdot(T, V)), Math.fround(ab * fdot(B, V)), facing]),
    })
    const surface = ours.lobeSurface([u(0, 1), u(0, 1), u(0, 1)], u(0, 1), rough, N, V)
    const toward = unitF32([u(-1, 1), u(-1, 1), u(-1, 1)]),
      L = fdot(N, toward) < 0 ? toward.map((x) => -x) : toward
    const args = [surface, N, V, [...L, u(0.1, 20)]]
    const a = ours.surfaceLight(...args),
      b = theirs.surfaceLight(...args)
    if (a.some((v) => v !== 0)) lit++
    if (!a.every((v, i) => Object.is(v, b[i]))) moved++
    assert.deepEqual(bytes(a), bytes(b), `round ${round}: ${a} against ${b}`)
  }
  // The sweep lights its pixels: nearly every light faces the base it is drawn in front of.
  assert.ok(lit > 3600, `${lit} lit, ${moved} with other floats`)
})
