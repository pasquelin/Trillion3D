// The fog's second layer, its end distance and its cubemap, against the shipped shader text run as
// shipped (`shaderRun`): the second layer's integral adds to the first's along the same ray and a
// fog whose first layer has no density still shows; the end distance cuts the ray where it passes
// that distance on the horizontal, for a surface and for the sky; the cubemap, tinted, gives the
// colour by the ray's direction turned about the vertical and blended by its length, and switches
// the sun's lobe off. The oracle integrates the layers numerically, 20 000 steps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  COLOR,
  RGB,
  SUN,
  fogRun,
  near,
  points,
  wgslFogged,
  type V3,
} from './fogShaderRun.fixture.ts'

/** One layer of the oracle: its density at its base height, its falloff, its base height. */
type Layer = { density: number; falloff: number; base: number }

/** The fog over `RGB` at `P` seen from `eye` by numerical integration: the ray cut short where it
 *  passes `end` on the horizontal, the layers' densities summed along it, `(ln 2)²` times their
 *  integral the optical depth. */
function layersLaw(layers: Layer[], eye: V3, P: V3, color: V3, end = 0) {
  const to = [P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]]
  const horizontal = Math.hypot(to[0], to[2])
  const scale = end > 0 && horizontal > end ? end / horizontal : 1
  const length = Math.hypot(...to) * scale
  let sum = 0
  for (let i = 0, n = 20000; i < n; i++) {
    const y = eye[1] + to[1] * scale * ((i + 0.5) / n)
    for (const { density, falloff, base } of layers)
      sum += density * 2 ** (-falloff * (y - base)) * (length / n)
  }
  const kept = Math.exp(-(Math.LN2 ** 2) * sum)
  return RGB.map((v, c) => v * kept + color[c] * (1 - kept))
}

const EYE: V3 = [0, 2, 0]
const FIRST: Layer = { density: 0.01, falloff: 0.05, base: 3 }
const SECOND: Layer = { density: 0.02, falloff: 0.1, base: 13 }
const FOG = {
  color: [0.1, 0.2, 0.3] as const,
  baseDensity: FIRST.density,
  falloff: FIRST.falloff,
  baseHeight: FIRST.base,
  secondLayer: { baseDensity: SECOND.density, falloff: SECOND.falloff, heightShift: 10 },
}

test('second fog: the two layers’ integrals add along the ray', () => {
  for (const P of points([40, 2, 0, 10, -3, 30, 200, 40, 80, 0, 30, 10, 400, 2, 0]))
    for (const eye of [EYE, [5, 25, -3] as V3])
      near(
        wgslFogged(FOG, RGB, P, eye),
        layersLaw([FIRST, SECOND], eye, P, FOG.color),
        `${eye} ${P}`,
        5e-5,
      )
  // The layer alone: a second layer at density 0 is no layer.
  const alone = { ...FOG, secondLayer: { ...FOG.secondLayer, baseDensity: 0 } }
  near(
    wgslFogged(alone, RGB, [200, 40, 80], EYE),
    layersLaw([FIRST], EYE, [200, 40, 80], FOG.color),
    'one layer',
    5e-5,
  )
})

test('second fog: a fog whose first layer has no density shows by the second', () => {
  const fog = { ...FOG, baseDensity: 0 }
  const P: V3 = [200, 40, 80]
  near(wgslFogged(fog, RGB, P, EYE), layersLaw([SECOND], EYE, P, FOG.color), 'second alone', 5e-5)
  // Densities of zero in both: no fog, the lit colour as it is.
  const none = { ...fog, secondLayer: { baseDensity: 0 } }
  assert.deepEqual(wgslFogged(none, RGB, P, EYE), RGB)
  // The second layer is held to its bounds: a density of 5 reads as the bound, 1 per metre.
  const dense = { ...FOG, secondLayer: { ...FOG.secondLayer, baseDensity: 5 } }
  const held = { ...FOG, secondLayer: { ...FOG.secondLayer, baseDensity: 1 } }
  near(wgslFogged(dense, RGB, P, EYE), wgslFogged(held, RGB, P, EYE), 'held', 0)
})

test('second fog: a layer that has a density holds the eye 655 m above its base, though the first has none', () => {
  // The fog is seen from the held height: a far higher eye reads what an eye at that height does.
  const fog = {
    ...FOG,
    baseDensity: 0,
    falloff: 0.001,
    secondLayer: { baseDensity: 0.01, falloff: 0.001, heightShift: 10 },
  }
  const held: V3 = [0, 3 + 10 + 655.36, 0]
  const P: V3 = [50, 600, 80]
  near(wgslFogged(fog, RGB, P, [0, 5000, 0]), wgslFogged(fog, RGB, P, held), 'held', 1e-6)
  // Without a density in either layer nothing holds it: there is no fog at all.
  const none = { ...fog, secondLayer: { baseDensity: 0 } }
  assert.deepEqual(wgslFogged(none, RGB, P, [0, 5000, 0]), RGB)
})

test('end distance: the ray stops integrating where it passes the distance on the horizontal', () => {
  const fog = { ...FOG, horizontalLimit: 100 }
  const P: V3 = [300, 22, 400]
  // The ray is cut to a fifth of its length: its point is the point there, whatever the fog beyond.
  const cut: V3 = [60, 6, 80]
  near(wgslFogged(fog, RGB, P, EYE), wgslFogged(FOG, RGB, cut, EYE), 'cut', 1e-5)
  near(
    wgslFogged(fog, RGB, P, EYE),
    layersLaw([FIRST, SECOND], EYE, P, FOG.color, 100),
    'integral',
    5e-5,
  )
  // Nearer than the distance on the horizontal, and the distance 0, nothing is cut.
  const inside: V3 = [30, 12, 40]
  near(wgslFogged(fog, RGB, inside, EYE), wgslFogged(FOG, RGB, inside, EYE), 'inside', 0)
  near(
    wgslFogged({ ...FOG, horizontalLimit: 0 }, RGB, P, EYE),
    layersLaw([FIRST, SECOND], EYE, P, FOG.color),
    'none',
    5e-5,
  )
})

test('end distance: the sky’s ray is cut the same, and keeps the fog it would have there', () => {
  const dir = [0.6, 0.0, 0.8] as const
  const { fogBeyond } = fogRun<{ fogBeyond: (d: readonly number[], e: V3) => number[] }>(
    { ...FOG, horizontalLimit: 100 },
    ['fogBeyond'],
  )
  const beyond = fogBeyond(dir, EYE)
  const at: V3 = [EYE[0] + dir[0] * 100, EYE[1], EYE[2] + dir[2] * 100]
  const lit = wgslFogged({ ...FOG, horizontalLimit: 100 }, [1, 1, 1], at, EYE)
  const dark = wgslFogged({ ...FOG, horizontalLimit: 100 }, [0, 0, 0], at, EYE)
  near(beyond.slice(0, 3), dark, 'light', 2e-5)
  near([beyond[3]], [lit[0] - dark[0]], 'transmittance', 2e-5)
  // Without the end distance an endless ray through this fog keeps no light and a sky to the horizon.
  const endless = fogRun<{ fogBeyond: (d: readonly number[], e: V3) => number[] }>(FOG, [
    'fogBeyond',
  ]).fogBeyond(dir, EYE)
  assert.ok(endless[3] < beyond[3], 'the cut ray keeps more of what lies behind')
})

/** A fake cubemap the shader reads through `fogCubeSharp` and `fogCubeAverage`, the calls it
 *  receives kept: its sharpest level a colour of the direction, its smallest a flat one. */
function cubemap() {
  const calls: { direction: number[]; sharp: boolean }[] = []
  const sample = (direction: number[], sharp: number) => {
    calls.push({ direction: [...direction], sharp: sharp > 0 })
    return sharp > 0 ? [1, 0.5, 0.25] : [0.2, 0.4, 0.6]
  }
  const decl = wgslBlock(
    'FOG_TEST_CUBEMAP',
    [],
    `fn fogCubeSharp(direction:vec3f)->vec3f{return cubeSample(direction,1.0);}
fn fogCubeAverage(direction:vec3f)->vec3f{return cubeSample(direction,0.0);}
fn fogVolumeExclude(toward:vec3f)->f32{return 0.0;}
fn fogVolumeLookup(toward:vec3f,infinite:bool)->vec4f{return vec4f(0.0,0.0,0.0,1.0);}`,
  )
  return { calls, resources: { decl, scope: { cubeSample: sample } } }
}

const CUBE_FOG = {
  color: [9, 9, 9] as const,
  baseDensity: 0.05,
  falloff: 0,
  cubemap: {
    size: 4,
    texels: [],
    tint: [0.5, 1, 2] as const,
    turn: 90,
    sharpFrom: 100,
    averageUntil: 10,
  },
}

test('cubemap: the tint takes the colour’s place; the cubemap gives it, by direction and length', () => {
  const { calls, resources } = cubemap()
  // 55 m along +x: halfway between the average-colour distance and the direct-use distance.
  const P: V3 = [55, 2, 0]
  const kept = Math.exp(-(Math.LN2 ** 2) * 0.05 * 55)
  const blended = [0.6, 0.45, 0.425]
  const tint = [0.5, 1, 2]
  const want = RGB.map((v, c) => v * kept + blended[c] * tint[c] * (1 - kept))
  near(wgslFogged(CUBE_FOG, RGB, P, EYE, { resources }), want, 'blend', 5e-5)
  // Turned 90° about the vertical, +x reads where +z is: both levels, the average the last one.
  assert.equal(calls.length, 2)
  for (const { direction } of calls) near(direction, [0, 0, 55], 'direction', 1e-5)
  assert.deepEqual(calls.map((c) => c.sharp).sort(), [false, true])
  // Shorter than the average-colour distance only the average is read; past the other, the sharpest.
  const at = (x: number) => {
    const t = Math.exp(-(Math.LN2 ** 2) * 0.05 * x)
    return (colour: number[]) => RGB.map((v, c) => v * t + colour[c] * tint[c] * (1 - t))
  }
  near(
    wgslFogged(CUBE_FOG, RGB, [5, 2, 0], EYE, { resources }),
    at(5)([0.2, 0.4, 0.6]),
    'average',
    5e-5,
  )
  near(
    wgslFogged(CUBE_FOG, RGB, [500, 2, 0], EYE, { resources }),
    at(500)([1, 0.5, 0.25]),
    'sharpest',
    5e-5,
  )
})

test('cubemap: no lobe of the sun; the colour of a fog without one is the fog’s', () => {
  const { resources } = cubemap()
  const lit = {
    ...CUBE_FOG,
    directional: { color: [1, 1, 1] as const, exponent: 1, startDistance: 0 },
  }
  const P: V3 = [200, 2, 0]
  const scene = { sun: SUN, resources }
  near(
    wgslFogged(lit, RGB, P, EYE, scene),
    wgslFogged(lit, RGB, P, EYE, { resources }),
    'cubemap, with a sun and none',
    0,
  )
  // The same fog without the cubemap does scatter the sun.
  const plain = { ...lit, cubemap: undefined, color: COLOR }
  const sunny = wgslFogged(plain, RGB, P, EYE, { sun: { ...SUN, toward: [1, 0, 0] } })
  const shaded = wgslFogged(plain, RGB, P, EYE)
  assert.ok(sunny[0] > shaded[0] + 0.01, 'the lobe adds light toward the sun')
})

test('the air’s second light: a second lobe of the same law, toward it', () => {
  const air = { sky: [0.2, 0.3, 0.5] as V3, ground: [4, 3, 2] as V3 }
  const fog = {
    ...FOG,
    directional: { exponent: 3, startDistance: 30, color: [0.4, 0.2, 0.1] as V3 },
  }
  const P: V3 = [200, 40, 80]
  const toward: V3 = [0.6, 0.8, 0]
  // The lobe toward the first light, with its light on the ground and the fog's own colour...
  const first = wgslFogged(fog, RGB, P, EYE, { sun: { toward, luminance: 5 }, air })
  // ...is the lobe the second light gives where the first points away and the second is that light.
  const away: V3 = [-0.6, -0.8, 0]
  const second = wgslFogged(fog, RGB, P, EYE, {
    sun: { toward: away, luminance: 5 },
    air: { ...air, ground: [0, 0, 0], second: { toward, ground: air.ground } },
  })
  const dry = wgslFogged(fog, RGB, P, EYE, { sun: { toward: away, luminance: 5 }, air })
  near(second, first, 'the second light as the first', 1e-5)
  assert.ok(first[0] > dry[0] + 0.01, 'the lobe adds light toward the light')
  // Held, even with no light on the ground, it scatters the fog's own lobe colour toward it.
  const held = wgslFogged(fog, RGB, P, EYE, {
    sun: { toward: away, luminance: 5 },
    air: { ...air, ground: [0, 0, 0], second: { toward, ground: [0, 0, 0] } },
  })
  const bare = wgslFogged(fog, RGB, P, EYE, {
    sun: { toward: away, luminance: 5 },
    air: { ...air, ground: [0, 0, 0] },
  })
  assert.ok(held[0] > bare[0] + 1e-3, 'the second light, held, lights the fog’s own colour')
})

test('a ray of a few hundredths of a millimetre keeps its length: the floor under its squared length is a float’s, in metres', () => {
  // A medium of 10⁶ per metre over 2·10⁻⁵ m (a ray whose squared length, 4·10⁻¹⁰, is under 10⁻⁸):
  // the exponent of two is `(ln 2)·10⁶ · 2·10⁻⁵`, the light kept about `2⁻¹⁴`; a floor of 10⁻⁸ on the squared
  // length would read the ray 5 times too short (`2⁻²·⁸`).
  const fog = { baseDensity: 1e6, falloff: 0, color: COLOR }
  const kept = 2 ** (-Math.LN2 * 1e6 * 2e-5)
  const got = wgslFogged(fog, RGB, [2e-5, 0, 0], [0, 0, 0])
  near(
    got,
    RGB.map((v, c) => v * kept + COLOR[c] * (1 - kept)),
    'tiny ray',
    1e-5,
  )
})
