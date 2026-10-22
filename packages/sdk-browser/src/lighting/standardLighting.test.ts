// The GGX lobe of a sharp highlight is the distribution's own, not 1 − cos²'s stairs. The
// shipped `standardLighting` runs in f32 (`shaderRunF32.fixture.ts`) against the same BRDF in f64
// at the same inputs: a half-vector swept through the lobe's core at the roughness floor, where the
// textbook D was 9 % off and took 2 685 values over 5 000 directions (stair rings).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from './shaderRunF32.fixture.ts'
import { ROUGHNESS_FLOOR } from './shaderConstants.ts'
import { STANDARD_LIGHTING_WGSL } from './standardLighting.ts'
import { LOBELESS_LIGHTING_WGSL } from './direct/lobesWgsl.ts'
import { saturate } from '../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { dotVector3 } from '../../../math/src/vector/vector.ts'
import { unit } from '../../../math/src/vector/vectorTuple.ts'
import { linearToSrgb8 } from '../../../math/src/color/color.ts'
import { aoOcclusionShader, aoShapeOf } from './ao/occlusionWgsl.ts'
import { quadBlur } from './ao/reference.fixture.ts'
import { runChain } from './ao/chain.fixture.ts'
import {
  createScene,
  HEIGHT,
  sceneScope,
  settingsOf,
  uniformOf,
  WIDTH,
} from './ao/scene.fixture.ts'

/** The standard lobe as a program holds it, its library declarations and lobeless hooks included. */
const STANDARD_LIGHTING = wgslModule(STANDARD_LIGHTING_WGSL, LOBELESS_LIGHTING_WGSL)

type V3 = number[]
type T3 = [number, number, number]
type Run = Record<string, (...args: unknown[]) => V3>
/** One light on a whole surface, as the loop runs it: its surface (`lobeSurface`), then the light
 *  (`surfaceLight`), the direction unit as every caller hands it. */
const lit = (run: Run) => (rgb: V3, metal: number, rough: number, N: V3, V: V3, light: V3) =>
  run.surfaceLight(run.lobeSurface(rgb, metal, rough, N, V), N, V, light)
const standardLighting = lit(
  shaderRun<Run>(STANDARD_LIGHTING, ['lobeSurface', 'surfaceLight'], F32_SCOPE),
)

const along = (n: V3, side: V3, t: number) =>
  unit(n.map((x, k) => x * Math.cos(t) + side[k] * Math.sin(t)) as T3)

/** The metal lobe in f64: D (with the sine of the half-vector from a cross product), the
 *  height-correlated visibility and the Fresnel term, as the shader writes them. */
function metalLobe(rough: number, N: V3, V: V3, L: V3) {
  const [n, v, l] = [N, V, L].map((x) => unit([...x] as T3))
  const H = unit([0, 1, 2].map((k) => l[k] + v[k]) as T3)
  const [c, nl, nv] = [dotVector3(n, H), dotVector3(n, l), dotVector3(n, v)]
  const a2 = rough ** 4
  const D = a2 / (Math.PI * (1 - c * c + c * c * a2) ** 2)
  const vis =
    0.5 / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2) + 1e-7)
  return D * vis * (0.5 + 0.5 * (1 - dotVector3(v, H)) ** 5) * nl
}

test('a sharp highlight is the GGX distribution, to f32, through its core', () => {
  const rough = ROUGHNESS_FLOOR
  const alpha = rough * rough
  const N = unit([0.3, 0.8, 0.52]).map(Math.fround)
  const T = unit([N[1], -N[0], 0])
  const B = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]]
  const V = along(N, T, 0.6).map(Math.fround)
  const values = new Set<number>()
  let worst = 0
  for (let i = 0; i < 5000; i++) {
    const phi = i * 2.399963
    const H = along(
      N,
      [0, 1, 2].map((k) => T[k] * Math.cos(phi) + B[k] * Math.sin(phi)),
      (alpha * i) / 5000,
    )
    const L = [0, 1, 2].map((k) => Math.fround(2 * dotVector3(V, H) * H[k] - V[k]))
    const got = standardLighting([0.5, 0.5, 0.5], 1, rough, N, V, [...L, 1])[0]
    worst = Math.max(worst, Math.abs(got / metalLobe(rough, N, V, L) - 1))
    values.add(got)
  }
  // What is left is the half-vector's own rounding: d ln D / dθ reaches 2/α, so H's f32 angle
  // (~1e-7 rad) alone moves D by ~3e-5 at the floor.
  assert.ok(worst < 1e-4, `worst relative error ${worst}`)
  assert.ok(values.size > 4990, `${values.size} values over the core`)
})

/** The displayed byte of a linear value: clamped, sRGB-encoded, quantised to 8 bits. */
const byte = (x: number) => linearToSrgb8(saturate(x))

test('the Fresnel fifth power as products displays the bytes pow displayed', () => {
  const shipped = 'let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;return f0+(1.0-f0)*(x2*x2*x);'
  assert.ok(STANDARD_LIGHTING.includes(shipped))
  const viaPow = lit(
    shaderRun<Run>(
      STANDARD_LIGHTING.replace(shipped, 'return f0+(1.0-f0)*pow(clamp(1.0-cosine,0.0,1.0),5.0);'),
      ['lobeSurface', 'surfaceLight'],
      F32_SCOPE,
    ),
  )
  const N = unit([0.3, 0.8, 0.52]).map(Math.fround)
  const T = unit([N[1], -N[0], 0])
  const B = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]]
  const around = (theta: number, phi: number) =>
    along(
      N,
      [0, 1, 2].map((k) => T[k] * Math.cos(phi) + B[k] * Math.sin(phi)),
      theta,
    ).map(Math.fround)
  let pixels = 0,
    worst = 0
  // Grazing views and lights, where the fifth power weighs most, through every roughness, metal,
  // albedo and the energies that span the displayed range.
  for (const rough of [ROUGHNESS_FLOOR, 0.2, 0.45, 0.7, 1])
    for (const metal of [0, 0.5, 1])
      for (const rgb of [
        [0.9, 0.6, 0.2],
        [0.05, 0.3, 0.95],
      ])
        for (let v = 0; v < 6; v++)
          for (let l = 0; l < 24; l++)
            for (const energy of [0.25, 1, 3]) {
              const V = around(0.05 + 0.29 * v, 0.4)
              const L = around(0.06 * l + 0.02, 0.4 + 0.7 * l)
              const got = standardLighting(rgb, metal, rough, N, V, [...L, energy])
              const was = viaPow(rgb, metal, rough, N, V, [...L, energy])
              for (let c = 0; c < 3; c++) {
                assert.equal(byte(got[c]), byte(was[c]), `${rough} ${metal} ${v} ${l} ${energy}`)
                if (was[c] > 1e-6) worst = Math.max(worst, Math.abs(got[c] / was[c] - 1))
              }
              pixels++
            }
  // Two f32 products against a correctly rounded power: a few units in the last place.
  assert.ok(worst < 1e-6, `worst relative deviation ${worst} over ${pixels} pixels`)
})

// The screen-space ambient occlusion (`ao/`): its tables, its plan and its uniform, then its shaders run in JavaScript over
// a synthetic view (`ao/scene.fixture.ts`) and set against the search written apart (`ao/reference.fixture.ts`).
test('a flat wall, a box’s face and the open sky are unoccluded; a concave corner is, near its crease', () => {
  const searchOf = (geometry: object, quality = 30) => {
    const scene = createScene(geometry)
    const settings = settingsOf({ ambientOcclusionLevels: 1, ambientOcclusionQuality: quality })
    const { aoSearch } = shaderRun<{ aoSearch: (p: number[]) => { value: number } }>(
      aoOcclusionShader(aoShapeOf('final', settings.shaderQuality, false)),
      ['aoSearch'],
      sceneScope(scene, uniformOf(1, 0, settings)),
    )
    return { scene, at: (x: number, y: number) => aoSearch([x, y]).value }
  }
  const every = Array.from({ length: HEIGHT }, (_, y) => y)
  const values = (at: (x: number, y: number) => number, rows: number[]) =>
    rows.flatMap((y) => Array.from({ length: WIDTH }, (_, x) => at(x, y)))
  // A wall facing the eye and an empty sky give every pixel the whole sky: a value of exactly one.
  assert.ok(
    values(searchOf({ wall: 5 }).at, every).every((v) => v === 1),
    'a flat wall',
  )
  assert.ok(
    values(searchOf({}).at, every).every((v) => v === 1),
    'no surface at all',
  )
  // A floor seen at a grazing angle is lightly marked, by the depth pyramid's blocks of two pixels, never as a crease.
  const floor = values(searchOf({ floor: 1.5 }).at, every)
  assert.ok(Math.min(...floor) > 0.8, `a grazing floor: ${Math.min(...floor)}`)
  const corner = searchOf({ floor: 1.5, wall: 6 }).at
  // The crease sits near row 26 of 36: the wall just above it and the floor just under it are occluded, the far wall is not.
  const near = values(corner, [23, 24, 25, 26, 27, 28])
  assert.ok(Math.min(...near) < 0.7, `the crease: ${Math.min(...near)}`)
  assert.ok(near.every((v) => v <= 1 && v > 0.5))
  assert.ok(
    values(corner, [0, 1, 2, 3, 4, 5]).every((v) => v === 1),
    'the wall far from the crease',
  )
  // A box standing in front of the wall: its own face is unoccluded, as a convex surface is.
  const { scene, at } = searchOf({ wall: 6, box: 3.5 })
  let faces = 0
  for (const y of every)
    for (let x = 0; x < WIDTH; x++)
      if (scene.surfaceAt(x, y).depth === 3.5) {
        faces++
        assert.equal(at(x, y), 1, `the box's face at (${x}, ${y})`)
      }
  assert.ok(faces > 100, `${faces} pixels of the face`)
})

test('the occlusion’s passes are the search written apart, through each quality, resolution and radius mode', () => {
  const geometry = { floor: 1.5, wall: 6, box: 3.5 }
  // Each shader quality, over one, two and three resolutions (the blur among a quad is the fragment stage's, apart from the search).
  for (const [quality, levels] of [
    [3, 1],
    [10, 2],
    [30, 3],
    [60, 2],
    [80, 3],
    [100, 1],
  ]) {
    const chain = runChain(geometry, {
      ambientOcclusionQuality: quality,
      ambientOcclusionLevels: levels,
    })
    assert.equal(chain.passes.length, [1, 3, 5][levels - 1])
    assert.ok(chain.worst < 2e-6, `quality ${quality}, ${levels} levels: ${chain.worst}`)
  }
  // The radius in the world's units, a larger bias, power and intensity, another climb of the pyramid.
  const tuned = runChain(geometry, {
    ambientOcclusionQuality: 80,
    ambientOcclusionRadiusInWorldSpace: true,
    ambientOcclusionRadius: 1.2,
    ambientOcclusionBias: 6,
    ambientOcclusionPower: 1.5,
    ambientOcclusionIntensity: 0.8,
    ambientOcclusionMipScale: 2.5,
  })
  assert.ok(tuned.worst < 2e-6, `tuned: ${tuned.worst}`)
  // The coarse levels do blend in: the same view at one resolution differs from three.
  const one = runChain(geometry, { ambientOcclusionQuality: 80, ambientOcclusionLevels: 1 })
  const three = runChain(geometry, { ambientOcclusionQuality: 80, ambientOcclusionLevels: 3 })
  assert.notDeepEqual(one.wgsl, three.wgsl)
})

test('a pixel past the fade’s end leaves the occlusion at one, and the intensity scales what is left', () => {
  const geometry = { floor: 1.5, wall: 6 }
  // Fade out from 2.5 m to 3 m: the wall, 6 m away, takes none; the floor near the eye still does.
  const faded = runChain(geometry, {
    ambientOcclusionLevels: 1,
    ambientOcclusionFadeDistance: 3,
    ambientOcclusionFadeRadius: 0.5,
  })
  assert.ok(faded.worst < 2e-6)
  const wall = faded.wgsl.slice(0, 20).flat()
  assert.ok(
    wall.every((v) => v === 1),
    'the wall past the fade',
  )
  const half = runChain(geometry, { ambientOcclusionLevels: 1, ambientOcclusionIntensity: 0.25 })
  const full = runChain(geometry, { ambientOcclusionLevels: 1, ambientOcclusionIntensity: 1 })
  const crease = (chain: typeof half) => Math.min(...chain.wgsl.flat())
  // 1 - (1 - raised) · intensity: a quarter of the darkening is a quarter of the whole's.
  assert.ok(Math.abs(1 - crease(half) - (1 - crease(full)) / 4) < 1e-6)
})

test('a pixel blends with its two neighbours of the quad by how alike their normals are, as the fine derivatives read them', () => {
  const scene = createScene({ floor: 1.5, wall: 6 })
  const settings = settingsOf({ ambientOcclusionLevels: 1, ambientOcclusionQuality: 30 })
  const text = aoOcclusionShader(aoShapeOf('final', settings.shaderQuality, false))
  const { aoSearch } = shaderRun<{ aoSearch: (p: number[]) => AoSample }>(
    text,
    ['aoSearch'],
    sceneScope(scene, uniformOf(1, 0, settings)),
  )
  type AoSample = { value: number; depth: number; normal: number[] }
  const at = (x: number, y: number) => aoSearch([x, y])
  // The fine derivative along an axis is the difference of the quad's two pixels along it, the same for both of them.
  const derivative = (axis: 0 | 1, x: number, y: number) => {
    const [a, b] = axis ? [at(x, y & ~1), at(x, y | 1)] : [at(x & ~1, y), at(x | 1, y)]
    return [b.value - a.value, 0, b.normal[0] - a.normal[0], b.normal[1] - a.normal[1]]
  }
  let blurred = 0
  for (const [x, y] of [
    [10, 25],
    [11, 25],
    [10, 26],
    [11, 26],
    [30, 27],
    [31, 26],
  ]) {
    const own = at(x, y)
    const { aoQuadBlur } = shaderRun<{ aoQuadBlur: (s: AoSample, p: number[]) => number }>(
      text,
      ['aoQuadBlur'],
      { dpdxFine: () => derivative(0, x, y), dpdyFine: () => derivative(1, x, y) },
    )
    const got = aoQuadBlur(own, [x, y])
    const want = quadBlur(own, x, y, at)
    assert.ok(Math.abs(got - want) < 1e-6, `(${x}, ${y}): ${got} against ${want}`)
    blurred += Math.abs(got - own.value)
  }
  assert.ok(blurred > 0, 'the blur moves the values near the crease')
})
