// The ambient cubemap's light (`ambientCubemapWgsl.ts`): the mip a roughness picks, the direction a reflection is read along, and the
// two lights a surface takes — the cube along the normal at the mip four above the last as the irradiance of the environment's sum, the
// cube along the reflection at the mip of the roughness weighed on the surface's reflectance and the slab's grazing value, under a clear
// coat as the layers combine —, run in f32 against a twin of their definition.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { unit } from '../../../../math/src/vector/vectorTuple.ts'
import { ambientCubemapWgsl } from './ambientCubemapWgsl.ts'

type V3 = [number, number, number]
type Sample = { dir: number[]; mip: number }

const random = lcgRandom(4409)
const between = (low: number, high: number) => lerp(low, high, random())
const sphere = () => {
  const [z, t] = [between(-1, 1), between(0, 2 * Math.PI)]
  const r = Math.sqrt(1 - z * z)
  return [r * Math.cos(t), r * Math.sin(t), z] as V3
}
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0)
const facing = (N: V3) => {
  let V = sphere()
  while (dot(N, V) < 0.1) V = sphere()
  return V
}

const MIPS = 8
const COLOUR = [0.5, 1.5, 2]
const KEEP = 0.7
/** The cube as a function of the direction and the mip: a colour the test can recompute. */
const cubeAt = (dir: number[], mip: number) => [
  1 + 0.5 * dir[0] + 0.1 * mip,
  1 + 0.5 * dir[1] + 0.1 * mip,
  1 + 0.5 * dir[2] + 0.1 * mip,
]
const samples: Sample[] = []

/** The host's lighting the program lists, as stubs the weights of which the test knows. */
const f0Of = (rgb: number[], metal: number) => rgb.map((x) => 0.04 + x * metal)
const pair = (rough: number, NoV: number) => [0.9 - 0.4 * rough, 0.05 + 0.2 * NoV * (1 - rough)]
const slab = (f0: number[]) => Math.min(Math.max(50 * Math.max(...f0), 0), 1)
const coat = { coat: 0.6, coatRough: 0.3, coatN: unit([0.2, 0.1, 1]) as V3 }
let coated = false

const shader = (lobes: boolean) =>
  shaderRun<{
    cubemapMipFromRoughness: (roughness: number, mipCount: number) => number
    offSpecularPeakDirection: (N: V3, R: V3, roughness: number) => number[]
    ambientCubemapAt: (
      rgb: V3,
      metal: number,
      rough: number,
      N: V3,
      V: V3,
      ao: number,
    ) => number[][]
  }>(
    wgslModule(ambientCubemapWgsl(lobes)),
    ['cubemapMipFromRoughness', 'offSpecularPeakDirection', 'ambientCubemapAt'],
    {
      ...F32_SCOPE,
      ambientCube: {},
      ambientCubeSampler: {},
      ambientCubeColour: [...COLOUR, 0],
      textureNumLevels: () => MIPS,
      textureSampleLevel: (_cube: unknown, _sampler: unknown, dir: number[], mip: number) => {
        samples.push({ dir: [...dir], mip })
        return [...cubeAt(dir, mip), 1]
      },
      environmentLightingFrom: (rgb: number[], metal: number, irradiance: number[], ao: number) =>
        rgb.map((x, k) => (x * (1 - metal) * irradiance[k] * ao) / Math.PI),
      thinSurface: () => false,
      indirectF0: f0Of,
      indirectKeep: () => KEEP,
      environmentBrdfPair: pair,
      hasCoat: () => coated,
      lobes: coat,
    },
  )
const plain = shader(false),
  lobed = shader(true)

test('the mip a roughness picks is three above the last at one and 1.15 finer for every halving, a mirror held to 0.001', () => {
  assert.ok(Math.abs(plain.cubemapMipFromRoughness(1, MIPS) - (MIPS - 1 - 3)) < 1e-5)
  assert.ok(Math.abs(plain.cubemapMipFromRoughness(0.5, MIPS) - (MIPS - 1 - 3 - 1.15)) < 1e-5)
  const finest = plain.cubemapMipFromRoughness(0.001, MIPS)
  assert.equal(plain.cubemapMipFromRoughness(0, MIPS), finest)
  assert.ok(Number.isFinite(finest))
  for (let round = 0; round < 40; round++) {
    const roughness = between(0.02, 1)
    const expected = MIPS - 1 - (3 - 1.15 * Math.log2(roughness))
    assert.ok(Math.abs(plain.cubemapMipFromRoughness(roughness, MIPS) - expected) < 1e-4)
  }
})

test('a reflection is read along itself when smooth and along the normal when rough', () => {
  const N: V3 = [0, 0, 1]
  const R = unit([0.6, 0.2, 0.5]) as V3
  const smooth = plain.offSpecularPeakDirection(N, R, 0.0001)
  smooth.forEach((x, k) => assert.ok(Math.abs(x - R[k]) < 1e-3))
  const rough = plain.offSpecularPeakDirection(N, R, 1)
  rough.forEach((x, k) => assert.ok(Math.abs(x - N[k]) < 1e-6))
  for (let round = 0; round < 40; round++) {
    const roughness = between(0.05, 0.95)
    const a = roughness * roughness
    const t = (1 - a) * (Math.sqrt(1 - a) + a)
    const got = plain.offSpecularPeakDirection(N, R, roughness)
    got.forEach((x, k) => assert.ok(Math.abs(x - (N[k] + (R[k] - N[k]) * t)) < 1e-5))
  }
})

/** The direction and the mip the cube is read at for a lobe of normal `N` and roughness `rough` seen from `V`. */
function reading(N: number[], V: number[], rough: number) {
  const safe = Math.min(Math.max(rough, 0.001), 1)
  const a = safe * safe
  const t = (1 - a) * (Math.sqrt(1 - a) + a)
  const R = N.map((n, k) => 2 * dot(V, N) * n - V[k])
  return {
    direction: N.map((n, k) => n + (R[k] - n) * t),
    mip: MIPS - 1 - (3 - 1.15 * Math.log2(safe)),
  }
}

const near = (got: number, expected: number, label: string) =>
  assert.ok(
    Math.abs(got - expected) <= 1e-4 * Math.max(Math.abs(expected), 1e-2),
    `${label}: ${got} against ${expected}`,
  )

test('the light is the cube along the normal at the diffuse mip and along the reflection at the roughness mip, weighed on the slab', () => {
  coated = false
  for (const program of [plain, lobed]) {
    for (let round = 0; round < 60; round++) {
      const N = sphere()
      const V = facing(N)
      const rgb = [between(0, 1), between(0, 1), between(0, 1)] as V3
      const metal = between(0, 1),
        rough = between(0, 1),
        ao = between(0.2, 1)
      samples.length = 0
      const [diffuse, specular] = program.ambientCubemapAt(rgb, metal, rough, N, V, ao)
      assert.equal(samples.length, 2)
      // The diffuse light: along the normal, four mips above the last.
      assert.deepEqual(samples[0].dir, N)
      assert.equal(samples[0].mip, MIPS - 4)
      const { direction, mip } = reading(N, V, rough)
      samples[1].dir.forEach((x, k) =>
        assert.ok(Math.abs(x - direction[k]) < 1e-5, `round ${round}`),
      )
      assert.ok(Math.abs(samples[1].mip - mip) < 1e-4)
      const diffuseCube = cubeAt(N, MIPS - 4),
        specularCube = cubeAt(direction, samples[1].mip)
      const f0 = f0Of(rgb, metal)
      const ab = pair(rough, dot(N, V))
      for (let k = 0; k < 3; k++) {
        near(diffuse[k], diffuseCube[k] * COLOUR[k] * rgb[k] * (1 - metal) * ao, `diffuse ${round}`)
        near(
          specular[k],
          specularCube[k] * COLOUR[k] * (f0[k] * ab[0] + slab(f0) * ab[1]) * KEEP,
          `specular ${round}`,
        )
      }
    }
  }
})

test('the specular light takes no occlusion', () => {
  coated = false
  const N = sphere()
  const V = facing(N)
  const rgb: V3 = [0.4, 0.5, 0.6]
  const [, lit] = plain.ambientCubemapAt(rgb, 0.3, 0.4, N, V, 1)
  const [, occluded] = plain.ambientCubemapAt(rgb, 0.3, 0.4, N, V, 0.1)
  assert.deepEqual(lit, occluded)
})

test('under a clear coat the base lobe is weighed by what the coat leaves and the coat reads its own normal and roughness', () => {
  coated = true
  for (let round = 0; round < 40; round++) {
    const N = sphere()
    const V = facing(N)
    const rgb = [between(0, 1), between(0, 1), between(0, 1)] as V3
    const metal = between(0, 1),
      rough = between(0, 1)
    samples.length = 0
    const [, specular] = lobed.ambientCubemapAt(rgb, metal, rough, N, V, 1)
    assert.equal(samples.length, 3)
    const base = reading(N, V, rough),
      top = reading(coat.coatN, V, coat.coatRough)
    top.direction.forEach((x, k) => assert.ok(Math.abs(samples[2].dir[k] - x) < 1e-5))
    assert.ok(Math.abs(samples[2].mip - top.mip) < 1e-4)
    const f0 = f0Of(rgb, metal)
    const ab = pair(rough, dot(N, V)),
      coatAb = pair(coat.coatRough, Math.min(Math.max(dot(coat.coatN, V), 0), 1))
    const weight = coat.coat * (0.04 * coatAb[0] + 1 * coatAb[1])
    const baseCube = cubeAt(base.direction, base.mip),
      coatCube = cubeAt(top.direction, top.mip)
    for (let k = 0; k < 3; k++) {
      const under = baseCube[k] * COLOUR[k] * (f0[k] * ab[0] + slab(f0) * ab[1] * (1 - coat.coat))
      near(specular[k], under * (1 - weight) + coatCube[k] * COLOUR[k] * weight, `coated ${round}`)
    }
  }
  coated = false
})
