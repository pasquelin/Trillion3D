// The fog law (#345): a CPU oracle — the linear ramp, and the transmittance of a medium whose
// density falls off with height, integrated numerically along the view ray — against the shipped
// shader text, the fog over no resources run as shipped (`shaderRun`), so a shader edit is what the test sees.
// The extinction form is the old law, mapped to the height law the shader reads; the height fog's
// own fields — opacity, start and cutoff distance, the sun's lobe, the atmosphere's sky and sun —
// are read against the same oracle. With no fog the shader hands the lit colour back untouched.
// The oracle and the run are the fixture's (`fogShaderRun.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { DIRECT_LIGHT_WGSL } from './direct/lightWgsl.ts'
import { distanceVector3 } from '../../../math/src/vector/vector.ts'
import { AIR_BUFFER_STRUCT } from './atmosphere/layout.ts'
import { FOG_VIEW_SLOT, FOG_VIEW_SLOTS } from './fog/viewSlots.ts'
import { LIGHT_BUFFER_AT } from '../frame/backend/state/lightBufferLayout.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { FOG_SLOTS, packFog } from '../../../sdk-core/src/scene/core/fog.ts'
import type { ResolvedHeightFog } from '../../../sdk-core/src/scene/core/fogHeight.ts'
import {
  COLOR,
  HEIGHT,
  RGB,
  SUN,
  expected,
  heightLaw,
  lawHolds,
  fogRun,
  near,
  points,
  wgslFogged,
  type V3,
} from './fogShaderRun.fixture.ts'

test('linear fog: untouched before near, half-way between, the fog colour alone past far', () => {
  const fog = { color: COLOR, near: 10, far: 110 }
  const eye: V3 = [3, 2, -4]
  lawHolds(fog, eye, [3, 2, 1, 3, 2, 6, 3, 2, 56, 3, 2, 106, 3, 2, 300])
  const half = RGB.map((v, i) => (v + COLOR[i]) / 2)
  near(wgslFogged(fog, RGB, [3, 2, 56], eye), half, 'half', 2e-5)
  near(wgslFogged(fog, RGB, [3, 2, 300], eye), COLOR, 'far', 2e-5)
})

test('exponential fog: exp(−density·d) at every height when nothing falls off', () => {
  const fog = { color: COLOR, density: 0.02 }
  lawHolds(fog, [0, 5, 0], [0, 5, 50, 30, -20, 10, 0, 80, -40])
  const P: V3 = [0, 5, 50]
  near(wgslFogged(fog, RGB, P, [0, 5, 0]), expected(fog, P, [0, 5, 0]), 'e⁻¹', 2e-5)
})

test('height fog: the integrated density, looking level, up and down, from above and below', () => {
  const fog = { color: COLOR, density: 0.08, heightFalloff: 0.35, baseHeight: 1 }
  const some = [40, 2, 0, 40, 2.0001, 0, 10, -3, 30, 5, 25, -5, 0, 1, 200]
  lawHolds(fog, [0, 2, 0], some)
  lawHolds(fog, [0, -4, 0], some)
  // A long ray that barely rises: the mean of the two densities, where the closed form would round.
  lawHolds({ ...fog, density: 0.005 }, [0, 2, 0], [400, 2.0028, 0])
  // Deep inside a steep fog, far below its base: the densities pass the cap, the fog stays total.
  lawHolds({ ...fog, heightFalloff: 1 }, [0, -100, 0], [5, -99, 3, 5, -100, 3, 5, -101, 3])
})

test('a ray that falls steeply from far above: the density and the falloff are held at their floors, the fog stays finite', () => {
  // 400 m above a falloff of one per metre, the density at the eye underflows and is held to
  // 2⁻¹²⁵ of its base, and the line integral holds its falloff at −127: the fog these floors give
  // — about a fifth of the light kept — is a fog all the same, finite and in range.
  const fog = { color: COLOR, density: 0.08, heightFalloff: 1, baseHeight: 1 }
  const eye: V3 = [0, 400, 0]
  const shared = (0.08 / Math.LN2 ** 2) * 2 ** -125 * ((2 ** 127 - 1) / 127)
  for (const P of [
    [0, 0, 10],
    [300, 1, 0],
  ] as V3[]) {
    const kept = 2 ** -(shared * distanceVector3(P, eye))
    const want = RGB.map((v, i) => COLOR[i] + (v - COLOR[i]) * kept)
    near(wgslFogged(fog, RGB, P, eye), want, `the floors at ${P}`, 2e-5)
    assert.ok(kept > 0.1 && kept < 0.25, `${kept}`)
  }
})

test('the extinction form and its height-law spelling read the same pixels', () => {
  // `{ density, heightFalloff }` is mapped exactly — baseDensity = density / (ln 2)², falloff =
  // heightFalloff / ln 2 — so the scenes written with it keep their image.
  const old = { color: COLOR, density: 0.03, heightFalloff: 0.3, baseHeight: 2 }
  const spelled = { color: COLOR, baseDensity: 0.03 / Math.LN2 ** 2, falloff: 0.3 / Math.LN2 }
  for (const P of points([40, 3, 5, 10, -8, 60, 0, 30, 200]))
    near(
      wgslFogged({ ...spelled, baseHeight: 2 }, RGB, P, [0, 1, 0]),
      wgslFogged(old, RGB, P, [0, 1, 0]),
      `spelling ${P}`,
      1e-6,
    )
})

test('height fog: every field of the law, against the integrated density', () => {
  const eye: V3 = [0, 4, 0]
  // Nearer than the start distance, past it short of the lobe's, beyond the lobe's start toward the sun.
  for (const P of points([10, 4, 0, 60, 5, 0, 300, 40, 80, 200, -6, -120, 0, 60, 400]))
    near(wgslFogged(HEIGHT, RGB, P, eye, { sun: SUN }), heightLaw(HEIGHT, eye, P), `${P}`, 5e-5)
  // Past the cutoff there is no fog at all: the lit colour as it is.
  near(wgslFogged(HEIGHT, RGB, [600, 4, 0], eye, { sun: SUN }), RGB, 'cutoff', 0)
  // The opacity stops at its maximum: a very dense fog leaves 10 % of the lit colour.
  const dense = { ...HEIGHT, baseDensity: 5, startDistance: 0, cutoffDistance: 0 }
  const P: V3 = [200, 4, 0]
  near(wgslFogged(dense, RGB, P, eye, { sun: SUN }), heightLaw(dense, eye, P), 'opaque', 5e-5)
  near(
    wgslFogged({ ...dense, color: [0, 0, 0] }, RGB, P, eye),
    RGB.map((v) => v * 0.1),
    'max',
    5e-5,
  )
})

/** The view block of the light buffer holding the world plane `plane` — `dot(xyz, p) + w` at least 0
 *  kept — in its fog slot, as the CPU writes it: the offset taken to the eye `eye`. */
const planeView = (plane: number[], eye: V3) => ({
  fogView: Array.from({ length: FOG_VIEW_SLOTS }, (_, k) =>
    k === FOG_VIEW_SLOT.clipPlane
      ? [...plane.slice(0, 3), plane[3] + plane[0] * eye[0] + plane[1] * eye[1] + plane[2] * eye[2]]
      : [0, 0, 0, 0],
  ),
})

test('height fog: a clip plane between the eye and the point starts the fog at the plane, as a start distance there would', () => {
  const eye: V3 = [0, 4, 0],
    flat = { ...HEIGHT, startDistance: 0, cutoffDistance: 0 }
  const P: V3 = [0, 4, 100],
    scene = { sun: SUN }
  const fogged = (plane: number[], at = P) =>
    wgslFogged(flat, RGB, at, eye, { ...scene, ...planeView(plane, eye) })
  // The plane z = 30 keeps what lies beyond it: the normal (0, 0, 1) and the offset −30.
  const from30 = { ...flat, startDistance: 30 }
  const cut = fogged([0, 0, 1, -30])
  near(cut, wgslFogged(from30, RGB, P, eye, scene), 'the fog of a start distance of 30', 1e-6)
  near(cut, heightLaw(from30, eye, P), 'the integrated density from 30', 5e-5)
  const whole = wgslFogged(flat, RGB, P, eye, scene)
  assert.ok(
    cut.every((v, i) => Math.abs(v - whole[i]) > 1e-3),
    'it is not the fog from the eye',
  )
  // A plane behind the eye, or past the point, lies outside the ray: the fog from the eye.
  for (const plane of [
    [0, 0, 1, 10],
    [0, 0, 1, -300],
  ])
    near(fogged(plane), whole, `${plane}`, 0)
  // The plane the fog starts at may be slanted: the ray crosses it at its own distance.
  near(
    fogged([0.6, 0, 0.8, -24], [30, 4, 40]),
    wgslFogged({ ...flat, startDistance: 24 }, RGB, [30, 4, 40], eye, scene),
    'slanted: the ray, 50 long, is along the normal by 50 and the plane lies 24 away on it',
    1e-6,
  )
  // A plane whose normal points the other way — drawn side beyond it, as a view clipped from above
  // or from the right is — starts the fog just the same: the reference's test of the sum of the
  // normal's components ignores it (a defect that loses the fog's start), ours tests a non-zero normal.
  const away: V3 = [0, 4, -100]
  near(
    fogged([0, 0, -1, -30], away),
    wgslFogged(from30, RGB, away, eye, scene),
    'the plane z = -30 keeps what lies beyond it, the fog starts there',
    1e-6,
  )
  near(
    fogged([-1, 0, 0, -30], [-100, 4, 0]),
    wgslFogged(from30, RGB, [-100, 4, 0], eye, scene),
    'x',
    1e-6,
  )
})

test('height fog: the plane is crossed by the ray the fog integrates, from the eye held to its ceiling', () => {
  // 900 m up, past 655 m above the base: the eye is held at 658.36 and the ray's rise compensated.
  const eye: V3 = [0, 900, 0],
    P: V3 = [0, 100, 300],
    flat = { ...HEIGHT, startDistance: 0, cutoffDistance: 0 }
  const held = HEIGHT.baseHeight + 655.36
  const ray = [0, P[1] - held, 300]
  // The plane y = 500 keeps what lies above it, the eye's side: where the compensated ray crosses it
  // from the held observer, by the world's own arithmetic.
  const time = -(held - 500) / ray[1]
  const start = time * Math.hypot(ray[1], ray[2])
  near(
    wgslFogged(flat, RGB, P, eye, planeView([0, 1, 0, -500], eye)),
    wgslFogged({ ...flat, startDistance: start }, RGB, P, eye),
    'the fog starts where the held observer’s ray meets the plane',
    1e-5,
  )
})

test('height fog: the sky’s ray is measured from the plane too', () => {
  const eye: V3 = [0, 4, 0],
    flat = { ...HEIGHT, startDistance: 0, cutoffDistance: 0 }
  // A ray that rises 0.6 for each 0.8 it advances, leaving the scene: the plane z = 30 crosses it
  // 37.5 from the eye.
  const beyond = (fog: typeof flat, scene = {}) =>
    fogRun<{ fogBeyond: (dir: V3, eye: V3) => number[] }>(fog, ['fogBeyond'], scene).fogBeyond(
      [0, 0.6, 0.8],
      eye,
    )
  const cut = beyond(flat, planeView([0, 0, 1, -30], eye))
  near(cut, beyond({ ...flat, startDistance: 37.5 }), 'the sky’s fog starts at the plane', 1e-4)
  assert.ok(
    cut.some((v, i) => Math.abs(v - beyond(flat)[i]) > 1e-3),
    'it is not the fog from the eye',
  )
})

test('height fog: an atmosphere adds the sky’s radiance and the sun’s ground light to the fog’s own', () => {
  const eye: V3 = [0, 4, 0]
  const air = { sky: [0.2, 0.3, 0.5] as V3, ground: [4, 3, 2] as V3 }
  for (const P of points([300, 40, 80, 60, 5, 0]))
    near(
      wgslFogged(HEIGHT, RGB, P, eye, { sun: SUN, air }),
      heightLaw(HEIGHT, eye, P, air.sky, air.ground),
      `air ${P}`,
      5e-5,
    )
  // The default fog — black, the sky white, no start — takes all its colour from the sky.
  const plain: ResolvedHeightFog = {
    ...HEIGHT,
    startDistance: 0,
    color: [0, 0, 0],
    skyContribution: [1, 1, 1],
    directional: { ...HEIGHT.directional, color: [0, 0, 0] },
  }
  const P: V3 = [0, 4, 400]
  const got = wgslFogged(plain, RGB, P, eye, { sun: SUN, air })
  near(got, heightLaw(plain, eye, P, air.sky, air.ground), 'sky colour', 5e-5)
  const dry = wgslFogged(plain, RGB, P, eye, { sun: SUN })
  assert.ok(
    got.every((v, i) => v > dry[i] + 0.05),
    'the sky gives the black fog its colour',
  )
})

test('the default height fog: the declared defaults, converted, against the integral', () => {
  // The defaults of 0.02 and 0.2 per 1000 centimetres are 0.002 and 0.02 per metre.
  const defaults: ResolvedHeightFog = {
    color: [0, 0, 0],
    baseDensity: 0.02 / 10,
    falloff: 0.2 / 10,
    baseHeight: 0,
    maxOpacity: 1,
    startDistance: 0,
    cutoffDistance: 0,
    directional: { exponent: 4, startDistance: 10000 / 100, color: [0, 0, 0] },
    skyContribution: [1, 1, 1],
    second: { baseDensity: 0, falloff: 0.02, heightShift: 0 },
    horizontalLimit: 0,
  }
  const eye: V3 = [0, 2, 0]
  for (const P of points([500, 2, 0, 2000, 30, 100, 0, 300, 40]))
    near(wgslFogged({}, RGB, P, eye), heightLaw(defaults, eye, P), `default ${P}`, 5e-5)
  // The uniform medium: a falloff of 0 extinguishes at (ln 2)² · baseDensity per metre.
  const flat = wgslFogged({ baseDensity: 0.01, falloff: 0 }, RGB, [100, 2, 0], eye)
  near(
    flat,
    RGB.map((v) => v * Math.exp(-(Math.LN2 ** 2) * 0.01 * 100)),
    'uniform',
    5e-6,
  )
})

test('no fog: the shader hands the lit colour back as it is, the block all zero', () => {
  const block = packFog(undefined, new Float32Array(FOG_SLOTS * 4).fill(9), 0)
  assert.deepEqual(Array.from(block), new Array(FOG_SLOTS * 4).fill(0))
  for (const P of points([0, 0, 5, 1e4, -300, 2]))
    assert.deepEqual(wgslFogged(undefined, RGB, P, [0, 1, 0]), RGB)
})

/** The byte offset of each member of the structure `name` in `text`: words and arrays of the three
 *  sizes the light buffer holds. */
function offsetsOf(text: string, name: string) {
  const body = new RegExp(`struct ${name}\\{([^}]*)\\}`).exec(text)![1]
  const size: Record<string, number> = { vec4f: 16, vec2u: 8, DirectLight: 80 }
  const at: Record<string, number> = {}
  let offset = 0
  for (const [, member, , type, count] of body.matchAll(/(\w+):(u32|array<(\w+),?(\d*)>)/g)) {
    at[member] = offset
    offset += type ? size[type] * Number(count || 1) : 4
  }
  return at
}

test('the light buffer’s regions sit where the lighting, the air’s programs and the CPU read them', () => {
  const lights = offsetsOf(wgslModule(DIRECT_LIGHT_WGSL), 'DirectLights')
  const air = offsetsOf(AIR_BUFFER_STRUCT, 'AirBuffer')
  assert.equal(lights.atmosphere, LIGHT_BUFFER_AT.atmosphere)
  assert.equal(lights.fogView, LIGHT_BUFFER_AT.fogView)
  assert.equal(lights.ltc, LIGHT_BUFFER_AT.ltc)
  assert.equal(lights.items, LIGHT_BUFFER_AT.items)
  // The air's programs read the front of the same bytes, by the same names — the fog and the sky's
  // block the sky's draw reads the fog through —, its block, the view's, the haze volume and the
  // sky by direction, which they write.
  assert.equal(air.fog, lights.fog)
  assert.equal(air.atmosphere, lights.atmosphere)
  assert.equal(air.atmosphereView, lights.atmosphereView)
  assert.equal(air.fogView, lights.fogView)
  assert.equal(air.aerial, lights.aerial)
  assert.equal(air.skyRays, lights.skyRays)
})
