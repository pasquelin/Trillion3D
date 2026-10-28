// The lighting of a pixel on the light grid equals the sum over every light, bit for bit. The
// shipped `sliceLighting` and `declaredLight` — with the shipped `lampSeen` and
// `standardLighting` — run as JavaScript (`shaderRun`), once over the list of the pixel's cell,
// which the grid pass's oracle builds (`gridLists`, `gpuLightGridOracle.ts`), once over every light
// of the scene (`TILE_NO_SLICE`), in the four programs the resolve compiles: with and without
// shadow code, with and without rectangle code. A light left out of a cell reaches none of its
// points, so the full walk adds its exact zero there, and the two sums are the same numbers: random
// lamp sets of 1 to 256 lamps, a lamp touching one pixel, a cell every lamp reaches, the near plane
// and the far depth, an infinite range, a column no lamp meets. A NaN range never reaches the
// resolve: the contract refuses it. The lamp's own laws, as the shipped term gives them, are
// run here too: a spot's fade, a fall-off that is not the inverse square, the shares of diffuse and
// specular light.
import { kindLane } from '../../../../sdk-core/src/scene/light/lanes.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID,
  gridSlice,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightGridOracle.ts'
import { gridLists } from '../../../../../bench/runner/lighting/lightGridWalk.ts'
import { validateSceneLight } from '../../../../sdk-core/src/scene/light/validate.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { recordOf } from './lightReach.fixture.ts'
import { unit } from '../../../../math/src/vector/vectorTuple.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { NEAR, camera, pixelPoint, type Vec3 } from '../tiles/tileCamera.fixture.ts'
import { directLightingWgsl } from './lightLoop.fixture.ts'
import { testLight } from './testLight.fixture.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

type Lamp = { centre: Vec3; radius: number; spot: boolean }
type Sum = (...args: unknown[]) => number[]
const PROGRAMS = [false, true].flatMap((shadowed) =>
  [false, true].map((rects) =>
    wgslModule(
      directLightingWgsl({ unshadowed: !shadowed, rectless: !rects, lobeless: true }),
      STANDARD_LIGHTING_WGSL,
    ),
  ),
)
const NAMES = ['sliceLighting']
const K = wgslConstants(PROGRAMS[0])

/** A lamp's record as the contract writes it: a point, or a spot looking down. */
const record = ({ centre, radius, spot }: Lamp, rank: number) =>
  testLight({
    positionRange: [...centre, radius],
    colorIntensity: [1, 0.8 + (rank % 5) / 10, 0.6, 3 + (rank % 7)],
    directionCone: [0, -1, 0, spot ? 0.7 : -1],
    params: [kindLane(spot ? K.KIND_SPOT : 0), -1, 0, spot ? 0.9 : 0],
  })

/** What a program's light term reads besides the lights: no thin transmission, a lamp with no shadow
 *  slot (the shipped read answers one), the air's transmittance toward a light read per point: none. */
const scopeOf = (program: string, directLights: object, tileLights: number[]) => ({
  ...wgslConstants(program),
  directLights,
  tileLights,
  pixelModel: 0,
  sphereNoNewton: false,
  clearCoatBottom: false,
  mat2x3f: (a = [0, 0, 0], b = [0, 0, 0]) => [a, b],
  thinSubsurface: [0, 0, 0],
  surfaceModel: 2,
  shadowFactor: () => 1,
  airTintOf: () => [1, 1, 1],
  cloudShadowOnSurface: () => 1,
})

/** The four programs' sums at pixel (`px`, `py`) of depth `z`: over its cell's list, and over every lamp. */
function sums(view: TileView, lamps: Lamp[], px: number, py: number, z: number) {
  const { columns, columnsX } = gridLists(view, lamps)
  const listed =
    columns[Math.floor(py / GRID.cell) * columnsX + Math.floor(px / GRID.cell)].lists[gridSlice(z)]
  const P = pixelPoint(view, px, py, z)
  const N = [0.3, 0.9, 0.3].map((v) => v / Math.hypot(0.3, 0.9, 0.3)),
    V = [0.6, 0.8, 0]
  return PROGRAMS.map((program) => {
    const directLights = { count: lamps.length, items: lamps.map(record) }
    const scope = scopeOf(program, directLights, [7, 7, ...listed])
    const { sliceLighting } = shaderRun<{ sliceLighting: Sum }>(program, NAMES, scope)
    const at = (slice: number[]) => sliceLighting([0.8, 0.7, 0.6], 0.2, 0.5, N, V, P, 1, slice)
    return { cell: at([2, listed.length]), every: at([K.TILE_NO_SLICE, lamps.length]), listed }
  })
}

/** Asserts the cell's sum is every lamp's, bit for bit, in the four programs; returns the lamps listed. */
function same(view: TileView, lamps: Lamp[], px: number, py: number, z: number, where: string) {
  const all = sums(view, lamps, px, py, z)
  for (const { cell, every } of all)
    assert.ok(
      cell.every((v, i) => Object.is(v, every[i])),
      `${where}: ${cell} against ${every}`,
    )
  return all[0]
}

const view = camera([3, 6, -2], 0.8, -0.5, 70, 320, 200)

test('random lamp sets of 1 to 256: the cell list sums every lamp, bit for bit', () => {
  const r = lcgRandom(1369),
    u = (lo: number, hi: number) => lerp(lo, hi, r())
  let reached = 0
  for (let count = 1; count <= 256; count++) {
    const [px, py] = [Math.floor(u(0, 320)), Math.floor(u(0, 200))]
    const z = Math.fround(NEAR / Math.exp(u(Math.log(0.12), Math.log(300))))
    const at = pixelPoint(view, px, py, z)
    const lamps = [...Array(count).keys()].map((rank): Lamp => {
      const radius = Math.fround(Math.exp(u(Math.log(0.05), Math.log(30))))
      const reach = u(0, 1.5) * radius
      const dir = [u(-1, 1), u(-1, 1), u(-1, 1)],
        len = Math.hypot(...dir) || 1
      const centre = at.map((v, a) => Math.fround(v + (dir[a] / len) * reach)) as Vec3
      return { centre, radius, spot: rank % 3 === 0 }
    })
    const { cell } = same(view, lamps, px, py, z, `${count} lamps`)
    reached += +cell.some((v) => v > 0)
  }
  assert.ok(reached > 200, `${reached} of 256 sets light their pixel`)
})

test('the walk of every light leaves out a lamp the view does not draw, as the list that does not hold it does', () => {
  const r = lcgRandom(2701)
  const lamps = [...Array(12).keys()].map((rank): Lamp => ({
    centre: [(r() - 0.5) * 4, 1 + r(), (r() - 0.5) * 4] as Vec3,
    radius: 20,
    spot: rank % 3 === 0,
  }))
  const N = [0, 1, 0],
    V = [0.6, 0.8, 0],
    P = [0, 0.5, 0]
  const undrawn = 5
  for (const program of PROGRAMS) {
    const items = lamps.map(record)
    const directLights = { count: lamps.length, items }
    const listed = [...lamps.keys()].filter((rank) => rank !== undrawn)
    const scope = scopeOf(program, directLights, [7, 7, ...listed])
    const { sliceLighting } = shaderRun<{ sliceLighting: Sum }>(program, NAMES, scope)
    const at = (slice: number[]) => sliceLighting([0.8, 0.7, 0.6], 0.2, 0.5, N, V, P, 1, slice)
    const whole = at([K.TILE_NO_SLICE, lamps.length])
    // The view's bit in the kind word of that lamp alone.
    const kind = (items[undrawn] as { params: number[] }).params
    kind[0] = kindLane(K.KIND_UNDRAWN + (lamps[undrawn].spot ? K.KIND_SPOT : 0))
    const every = at([K.TILE_NO_SLICE, lamps.length]),
      cell = at([2, listed.length])
    assert.ok(
      every.every((v, i) => Object.is(v, cell[i])),
      `${every} against the list without it, ${cell}`,
    )
    assert.ok(
      every.some((v, i) => v !== whole[i]),
      'the lamp lit the point before the view left it out',
    )
  }
})

test('edge cases: one pixel touched, a cell every lamp reaches, near and far, an infinite range, an empty column', () => {
  const [px, py] = [319, 199]
  for (const z of [1, 0.5, 2 ** -12, NEAR / 1e5]) {
    const p = pixelPoint(view, px, py, z)
    const touching: Lamp = {
      centre: [p[0] + 0.3, p[1], p[2]],
      radius: Math.fround(0.30001),
      spot: false,
    }
    const every = [...Array(255).keys()].map((i): Lamp => ({
      centre: [p[0] + i / 9, p[1] - i / 7, p[2] + i / 5],
      radius: 1000 + i,
      spot: i % 2 === 0,
    }))
    const { cell, listed } = same(view, [touching, ...every], px, py, z, `depth ${z}`)
    assert.equal(listed.length, 256, 'every lamp listed')
    assert.ok(cell.some((v) => v > 0))
    const endless: Lamp = { centre: [p[0] + 50, p[1] + 20, p[2]], radius: Infinity, spot: false }
    assert.equal(same(view, [endless], px, py, z, `infinite range, depth ${z}`).listed.length, 1)
  }
  // A lamp in the far corner: the first column meets none, its list is empty and its sum zero.
  const far = pixelPoint(view, px, py, 2 ** -10)
  const empty = same(view, [{ centre: far, radius: 0.5, spot: false }], 5, 5, 0.5, 'empty column')
  assert.deepEqual([empty.listed.length, empty.cell], [0, [0, 0, 0]])
  const nan = {
    id: 'lamp',
    kind: 'point',
    position: [0, 0, 0],
    range: NaN,
    color: [1, 1, 1],
    intensity: 1,
  }
  assert.throws(() => validateSceneLight(nan as never), /range must be > 0/)
})

const LAMPS = shaderRun<{
  lampReach: (light: object, P: Vec3) => number[]
  isCapsule: (light: object) => boolean
  lampSeen: (
    light: object,
    P: Vec3,
    N: Vec3,
    bias: number,
  ) => { toward: Vec3; falloff: number; wrap: number }
}>(PROGRAMS[0], ['lampReach', 'isCapsule', 'lampSeen'], {
  ...F32_SCOPE,
  ...K,
  directLights: { items: [] },
})
const lampOf = (kind: SceneLight['kind'], extra: Partial<SceneLight> = {}) =>
  recordOf({
    ...{ id: kind, kind, color: [1, 1, 1], intensity: 3, castsShadow: false, range: 20 },
    ...{ position: [1, 2, 0.5], direction: [0, -1, 0], outerConeAngle: 0.8, ...extra },
  })

test('a spot’s fade is the square of a ramp in the cone’s cosine, from its outer cone to its inner one', () => {
  // The inner cone is where the light stops being whole: none by default (the whole cone fades),
  // half the cone, the outer cone itself (a ramp a milliradian wide).
  for (const [extra, inner, outer] of [
    [{}, 0, 0.8],
    [{ innerConeAngle: 0.4 }, 0.4, 0.8],
    [{ innerConeAngle: 0.8 }, 0.8, 0.801],
  ] as const)
    for (const angle of [0, 0.2, 0.4, 0.6, 0.79, 0.8005, 0.81]) {
      const ramp = (Math.cos(angle) - Math.cos(outer)) / (Math.cos(inner) - Math.cos(outer))
      const P: Vec3 = [Math.sin(angle), 2 - Math.cos(angle), 0.5]
      const mask = LAMPS.lampReach(lampOf('spot', { ...extra, position: [0, 2, 0.5] }), P)[3]
      near(mask, Math.min(Math.max(ramp, 0), 1) ** 2, `${inner} ${angle}`, 3e-5)
    }
})

test('a lamp off the inverse square is its mask alone, one less its squared range ratio to its exponent', () => {
  const seen = (extra: Partial<SceneLight>, d: number, bias = 1e-4) =>
    LAMPS.lampSeen(
      lampOf('point', { position: [0, 0, 0], range: 10, ...extra }),
      [d, 0, 0],
      [0, 0, 1],
      bias,
    )
  for (const d of [0.01, 1, 5, 9.9]) {
    const off = (1 - (d / 10) ** 2) ** 8
    near(seen({ inverseSquared: false }, d).falloff, off, `exponent 8 at ${d}`, 3e-5)
    const two = seen({ inverseSquared: false, radialExponent: 2 }, d, 0).falloff
    near(two, (1 - (d / 10) ** 2) ** 2, `exponent 2 at ${d}`, 3e-5)
    const squared = (1 - (d / 10) ** 4) ** 2 / (d * d + 1e-4)
    near(seen({}, d).falloff, squared, `the inverse square at ${d}`, 3e-5)
  }
  // A source widens nothing of the mask, but its horizon still wraps by the inverse square.
  const wide = seen({ inverseSquared: false, emitterRadius: 0.5 }, 1)
  near([wide.falloff, wide.wrap], [0.99 ** 8, 0.25 / (1 + 1e-4)], 'a sphere', 3e-5)
  // A rectangle is no lamp of size, whatever its axis lane holds.
  assert.equal(LAMPS.isCapsule(lampOf('rect', { right: [1, 0, 0], size: [2, 1] })), false)
})

test('a point light with a profile and no tube is no capsule and is lit as the same light without the profile; a tube still is a capsule', () => {
  const seen = (record: object) => LAMPS.lampSeen(record, [3, 0, 0.5], [0, 0, 1], 1e-4)
  const bare = lampOf('point', { position: [0, 0, 0], range: 10 })
  const profiled = lampOf('point', {
    position: [0, 0, 0],
    range: 10,
    direction: [0, 0, -1],
    iesProfile: 'p',
    emitterAxis: [1, 0, 0],
  })
  assert.equal(LAMPS.isCapsule(bare), false)
  assert.equal(LAMPS.isCapsule(profiled), false, 'the profile’s axis makes no tube')
  assert.deepEqual(seen(profiled), seen(bare), 'lit exactly as the same light without a profile')
  const tube = lampOf('point', {
    position: [0, 0, 0],
    range: 10,
    emitterLength: 2,
    emitterAxis: [1, 0, 0],
  })
  assert.equal(LAMPS.isCapsule(tube), true)
  assert.notDeepEqual(
    seen(tube).toward,
    seen(bare).toward,
    'the tube path: its mean direction is not the centre’s',
  )
  const both = lampOf('point', {
    position: [0, 0, 0],
    range: 10,
    direction: [0, 0, -1],
    iesProfile: 'p',
    emitterLength: 2,
    emitterAxis: [1, 0, 0],
  })
  assert.equal(LAMPS.isCapsule(both), true)
  assert.deepEqual(seen(both), seen(tube), 'a profiled tube is lit as the tube')
})

test('a light’s shares weigh its diffuse and its specular light: the term is their sum, weighed', () => {
  const lights = { count: 1, items: [] as object[] }
  const { sliceLighting } = shaderRun<{ sliceLighting: Sum }>(
    PROGRAMS[0],
    NAMES,
    scopeOf(PROGRAMS[0], lights, []),
  )
  const lit = (extra: Partial<SceneLight>, [diffuseShare, specularShare]: number[]) => {
    const light = { ...extra, diffuseShare, specularShare }
    lights.items = [lampOf(extra.kind ?? 'point', light)]
    const surface = [[0.8, 0.7, 0.6], 0.2, 0.5, [0, 1, 0], [0.6, 0.8, 0], [0, 0, 0], 1]
    return sliceLighting(...surface, [K.TILE_NO_SLICE, 1])
  }
  const kinds: Partial<SceneLight>[] = [
    { kind: 'point' },
    { kind: 'point', emitterRadius: 0.3 },
    { kind: 'point', emitterLength: 1, emitterAxis: [0, 0, 1] },
    { kind: 'spot' },
    { kind: 'directional', direction: unit([-0.2, -1, -0.1]) },
  ]
  for (const extra of kinds) {
    const [diffuse, specular, both, mixed] = [
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.25],
    ].map((s) => lit(extra, s))
    const label = JSON.stringify(extra)
    assert.ok(diffuse.every((c) => c > 0) && specular.every((c) => c > 0), `${label}: both lit`)
    near(
      both,
      diffuse.map((c, i) => c + specular[i]),
      `${label}: the whole`,
      1e-5,
    )
    near(
      mixed,
      diffuse.map((c, i) => 0.5 * c + 0.25 * specular[i]),
      `${label}: weighed`,
      1e-5,
    )
  }
})
