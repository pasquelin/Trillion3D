// A lobed pixel's light (`surfaceLight` through the lobe hooks, `lobesWgsl.ts`) tests the base's and
// the coat's facing before it pays the half-vector: a light behind both returns its zero before
// `H`, the coat's facing is read only under a coat. The same operations in the same order on every
// light that reaches the pixel: run in f32 (`shaderRun`, `F32_SCOPE`) beside the order it replaced,
// on random lights, in front and behind, lobes with and without strength and coat, the sums are the
// same numbers, bit for bit. Its anisotropic lobe reads T·H/αt and B·H/αb as products by the
// reciprocals `setLobes` takes once a pixel, and its distribution 1/(π αt αb q²) as the pixel's
// 1/(π αt αb) over q²: beside the two divides and the whole denominator, on lit anisotropic pixels
// down to grazing views and the roughness floor, the same 8-bit image under every exposure and
// curve. A lamp of size's highlight (`lampLight`, `lampLobeWgsl.ts`) runs the same lobes: with a
// source too small to see it is the point's, a sphere widens it and keeps its energy, a tube
// lights from the nearest point of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { ROUGHNESS_FLOOR } from '../shaderConstants.ts'
import { LOBES_LIGHTING_WGSL } from './lobesWgsl.ts'
import { DIRECT_LIGHT_WGSL } from './lightWgsl.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { unitF32 } from '../../../../math/src/vector/unitF32.fixture.ts'
import { linearToSrgb8 } from '../../../../math/src/color/color.ts'

type Light = (...args: unknown[]) => number[]
const NAMES = ['lobeSurface', 'surfaceLight']
const shipped = wgslModule(STANDARD_LIGHTING_WGSL, LOBES_LIGHTING_WGSL)
/** The order it replaced: the half-vector and the coat's facing first, whatever faces. */
const before = shipped.replace(
  /(light:vec4f\)->vec3f\{\n let L=light\.xyz;)[\s\S]*?(var base=vec3f\(0\.0\);)/,
  `$1
 let H=normalize(L+V);
 let NdotL=max(dot(N,L),0.0);
 let coatNdotL=coatCosine(L);
 $2`,
)

test('a lobed light pays the half-vector only where the base or the coat faces it, bit for bit', () => {
  assert.notEqual(before, shipped)
  const r = lcgRandom(1483),
    u = (lo: number, hi: number) => Math.fround(lerp(lo, hi, r()))
  // What a pixel's lights share of a surface, as the shipped loop takes it (`lobeSurface`).
  const { lobeSurface } = shaderRun<Record<string, Light>>(shipped, NAMES, F32_SCOPE)
  let zeros = 0,
    lit = 0
  for (let round = 0; round < 400; round++) {
    const N = unitF32([u(-1, 1), u(-1, 1), u(0.2, 1)])
    const V = unitF32([u(-1, 1), u(-1, 1), u(0, 1)])
    const coat = [0, 0, 1, u(0.1, 1)][round % 4]
    const strength = [0, 0.7][Math.floor(round / 4) % 2]
    const T = unitF32([N[1], -N[0], 0])
    const coatRough = u(0.05, 1),
      coatN = unitF32([u(-1, 1), u(-1, 1), u(-1, 1)])
    const at = u(0.05, 1),
      ab = u(0.05, 1)
    const lobes = {
      on: true,
      skewed: strength > 0,
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
      dScale: Math.fround(1 / Math.fround(Math.fround(Math.fround(Math.PI) * at) * ab)),
      viewLength: u(0.05, 1),
      coatSurface: lobeSurface([0, 0, 0], 0, coatRough, coatN, V),
    }
    const surface = lobeSurface([u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1), N, V)
    // The light's direction unit, as every caller hands it (`directIncidence`).
    const args = [surface, N, V, [...unitF32([u(-1, 1), u(-1, 1), u(-1, 1)]), u(0, 20)]]
    const run = (text: string) =>
      shaderRun<Record<string, Light>>(text, NAMES, { ...F32_SCOPE, lobes }).surfaceLight(...args)
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
  const ours = shaderRun<Record<string, Light>>(shipped, NAMES, { ...F32_SCOPE, lobes })
  const theirs = shaderRun<Record<string, Light>>(divides, NAMES, { ...F32_SCOPE, lobes })
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
    const strength = u(0.05, 1),
      coat = round % 5 ? 0 : u(0.1, 1),
      coatRough = u(0.05, 1),
      coatN = unitF32(N.map((n) => n + u(-0.2, 0.2)))
    const alpha = Math.fround(rough * rough),
      at = Math.fround(
        alpha + Math.fround(Math.fround(1 - alpha) * Math.fround(strength * strength)),
      )
    const facing = Math.fround(Math.max(fdot(N, V), Math.fround(1e-4)))
    Object.assign(lobes, {
      on: true,
      skewed: true,
      T,
      B,
      coat,
      coatRough,
      coatN,
      through: coat > 0 ? u(0.5, 1) : 1,
      at,
      ab: alpha,
      invAt: Math.fround(1 / at),
      invAb: Math.fround(1 / alpha),
      dScale: Math.fround(1 / Math.fround(Math.fround(pi * at) * alpha)),
      viewLength: flength([Math.fround(at * fdot(T, V)), Math.fround(alpha * fdot(B, V)), facing]),
      coatSurface: ours.lobeSurface([0, 0, 0], 0, coatRough, coatN, V),
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

type Fn<R = number[]> = (...args: unknown[]) => R
const AREA = wgslModule(DIRECT_LIGHT_WGSL, STANDARD_LIGHTING_WGSL, LOBES_LIGHTING_WGSL)
const AREA_NAMES = [
  'lobeSurface',
  'lampLight',
  'capsuleLamp',
  'lampLobe',
  'lobeEnergy',
  'sphereHalfCosines',
  'lineClosest',
  'capsuleLook',
  'surfaceLight',
]
const areaRun = (lobes: object) =>
  shaderRun<Record<string, Fn>>(AREA, AREA_NAMES, {
    ...F32_SCOPE,
    ...wgslConstants(AREA),
    directLights: { items: [] },
    lobes,
  })
const area = areaRun({ on: false, skewed: false, coat: 0, through: 1 }) as unknown as Record<
  string,
  Fn<any>
>
const Z = [0, 0, 1],
  VIEW = [-0.6, 0, 0.8],
  MIRROR = [0.6, 0, 0.8]
const metal = (rough: number) => area.lobeSurface([1, 1, 1], 1, rough, Z, VIEW)

test('a lamp too small to see lights as the point does: the same lobe, the coat and the skew included', () => {
  const r = lcgRandom(1584),
    u = (lo: number, hi: number) => Math.fround(lerp(lo, hi, r()))
  for (let round = 0; round < 200; round++) {
    const N = unitF32([u(-1, 1), u(-1, 1), u(0.2, 1)]),
      V = unitF32([u(-1, 1), u(-1, 1), u(0.3, 1)])
    const L = unitF32([u(-1, 1), u(-1, 1), u(0.1, 1)])
    const T = unitF32(fcross(N, [0, 1, 0])),
      alpha = u(0.2, 0.8)
    const coatN = unitF32(N.map((n) => n + u(-0.2, 0.2)))
    const skewed = round % 3 === 0,
      coat = round % 2 ? 0.7 : 0
    const lobes = {
      on: skewed || coat > 0,
      skewed,
      T,
      B: fcross(N, T),
      coat,
      coatRough: 0.4,
      coatN,
      through: 0.8,
      at: Math.fround(alpha * 1.5),
      ab: alpha,
      invAt: Math.fround(1 / (alpha * 1.5)),
      invAb: Math.fround(1 / alpha),
      dScale: Math.fround(1 / (Math.PI * alpha * alpha * 1.5)),
      viewLength: 1,
      coatSurface: area.lobeSurface([0, 0, 0], 0, 0.4, coatN, V),
    }
    const run = areaRun(lobes)
    const surface = run.lobeSurface([u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.3, 1), N, V)
    lobes.viewLength = flength([
      Math.fround(lobes.at * fdot(T, V)),
      Math.fround(alpha * fdot(lobes.B, V)),
      Math.max(fdot(N, V), 1e-4),
    ])
    const light = {
      positionRange: L.map((x) => x * 3),
      shape: [1e-6, 0, 0, 0],
      capsule: [0, 0, 0, 0],
    }
    const lamp = run.capsuleLamp(light.positionRange, [0, 0, 0], 1e-6, N, 1, 1e-4)
    const energy = u(1, 10)
    const sized = run.lampLight(surface, N, V, light, [0, 0, 0], lamp, energy),
      point = run.surfaceLight(surface, N, V, [...L, energy])
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs(sized[c] - point[c]) <= 2e-3 * Math.max(point[c], 1e-3),
        `${round}: ${sized} against ${point}`,
      )
  }
})

test('a sphere widens the highlight and keeps its energy; the soft radius and a tube widen it too', () => {
  // Known answers of the widening: a² 0.04 at V·H 0.8 with a sphere of sine 0.2, a soft radius's
  // sine 0.1, a tube whose ends are 0.6 apart in cosine.
  const energy = (sine: number, soft: number, lineCos: number) =>
    area.lobeEnergy(0.04, 0.8, sine, soft, lineCos)
  assert.deepEqual(energy(0, 0, 1), [0.04, 1])
  near(energy(0.2, 0, 1), [0.04, 0.444753], 1e-5)
  near(energy(0, 0.1, 1), [0.043049, 1], 1e-5)
  near(energy(0, 0, 0.6), [0.04, 0.434688], 1e-5)
  near(energy(0.2, 0.1, 0.6), [0.043049, 0.249152], 1e-5)
  // In the mirror direction the half vector is the normal's, `V·H` the view's cosine; a little off
  // it the sphere moves the half vector toward the normal, never away.
  near(area.sphereHalfCosines(0.8, 0.8, 0.28, 0.2), [1, 0.8], 1e-6)
  const off = [Math.sin(0.4), 0, Math.cos(0.4)]
  const plainH = fdot(Z, unitF32(off.map((x, k) => x + VIEW[k])))
  const moved = area.sphereHalfCosines(off[2], 0.8, fdot(off, VIEW), 0.2)
  assert.ok(moved[0] >= plainH && moved[0] <= 1, `${moved} against ${plainH}`)
  // The highlight: a sphere of 0.2 at 1 m lowers the mirror's peak and raises the lobe's flank.
  const lobe = (toward: number[], reach: number, soft = 0) =>
    area.lampLobe(metal(0.3), Z, VIEW, { toward, reach, soft }, toward[2], 1, 1)[0]
  const tilted = [Math.sin(1.1), 0, Math.cos(1.1)]
  assert.ok(lobe(MIRROR, 0.2) < lobe(MIRROR, 0), 'a lower peak')
  assert.ok(lobe(tilted, 0.2) > lobe(tilted, 0), 'a higher flank')
  assert.ok(lobe(MIRROR, 0, 0.1) < lobe(MIRROR, 0), 'the soft radius lowers the peak too')
})

test('a tube lights from the nearest point of it to the reflection', () => {
  const look = (halfX: number, view: number[]) =>
    area.capsuleLook([0, 0, 2], [halfX, 0, 0], 0, 0, Z, view)
  // The reflection of the view meets the tube: the highlight comes from that point, along the ray.
  const view = unitF32([-0.25, 0, 0.97]),
    R = [0.25 / Math.hypot(0.25, 0.97), 0, 0.97 / Math.hypot(0.25, 0.97)]
  near(look(1, view).toward, R, 1e-5)
  // It misses it: its end nearest the ray.
  near(look(1, unitF32([-0.8, 0, 0.6])).toward, unitF32([1, 0, 2]), 1e-5)
  // Along the tube's line: finite, the tube's start.
  assert.ok(look(1, unitF32([-1, 0, 0.0001])).toward.every(Number.isFinite))
  near(area.lineClosest([-1, 2, 0], [2, 0, 0], unitF32([0.25, 1, 0])), [0.5, 2, 0], 1e-5)
  assert.ok(area.lineClosest([-1, 2, 0], [2, 0, 0], [1, 0, 0]).every(Number.isFinite))
})
function near(got: number[], want: number[], tolerance: number) {
  want.forEach((w, i) => assert.ok(Math.abs(got[i] - w) <= tolerance, `${got} against ${want}`))
}
