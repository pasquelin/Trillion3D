// The path tracer's BSDF, run in JavaScript from the shipped text: a surface of a diffuse lobe under a GGX lobe.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GLASS_ENERGY_SIZE } from '../../../../sdk-core/src/lighting/glassEnergy.ts'
import { shadingEnergyWords } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'
import { sheenLtcHalves, SHEEN_LTC_SIZE } from '../../../../sdk-core/src/lighting/sheenLtc.ts'
import { fromHalf } from '../../../../math/src/float/half.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PT_MATERIAL_WGSL } from './materialWgsl.ts'

type Vec3 = [number, number, number]
interface Surface {
  position: Vec3
  geoNormal: Vec3
  normal: Vec3
  vertexNormal: Vec3
  diffuse: Vec3
  f0: Vec3
  roughness: number
  emission: Vec3
  hitT: number
  fuzzColor: Vec3
  fuzz: number
  transmit: Vec3
  ior: number
  glass: boolean
  thin: boolean
  tint: Vec3
  front: boolean
  selection: number
}
interface Bsdf {
  diffuseProb: number
  specProb: number
}
interface Sample {
  direction: Vec3
  weight: Vec3
  pdf: number
  scatter: number
}
const halves = sheenLtcHalves()
const sheen = Array.from({ length: SHEEN_LTC_SIZE ** 2 }, (_, i) => [
  (halves[4 * i] | (halves[4 * i + 1] << 16)) >>> 0,
  (halves[4 * i + 2] | (halves[4 * i + 3] << 16)) >>> 0,
])
const material = () =>
  shaderRun<{
    ptPrepareBsdf: (s: Surface, v: Vec3) => Bsdf
    ptEvalMaterial: (
      s: Surface,
      b: Bsdf,
      l: Vec3,
      scale: [number, number],
    ) => { weight: Vec3; pdf: number }
    ptSampleMaterial: (s: Surface, b: Bsdf, e: Vec3) => Sample
  }>(PT_MATERIAL_WGSL, ['ptPrepareBsdf', 'ptEvalMaterial', 'ptSampleMaterial'], {
    directLights: {
      energy: shadingEnergyWords(),
      sheen,
      glass: new Uint32Array(GLASS_ENERGY_SIZE ** 3).fill(0xffffffff),
    },
    unpack2x16float: (w: number) => [fromHalf(w & 0xffff), fromHalf(w >>> 16)],
    unpack2x16unorm: (w: number) => [(w & 0xffff) / 65535, (w >>> 16) / 65535],
  })

const surface = (diffuse: number, f0: number, roughness: number): Surface => ({
  position: [0, 0, 0],
  geoNormal: [0, 0, 1],
  normal: [0, 0, 1],
  vertexNormal: [0, 0, 1],
  diffuse: [diffuse, diffuse, diffuse],
  f0: [f0, f0, f0],
  roughness,
  emission: [0, 0, 0],
  hitT: 1,
  fuzzColor: [0, 0, 0],
  fuzz: 0,
  transmit: [0, 0, 0],
  ior: 1.5,
  glass: false,
  thin: false,
  tint: [1, 1, 1],
  front: true,
  selection: 1,
})

/** The integral over the upper hemisphere of `f(direction)`, by midpoints of the cosine-uniform grid of `n` by `n`. */
function hemisphere(f: (l: Vec3) => number, n = 96) {
  let sum = 0
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const z = (i + 0.5) / n
      const phi = (2 * Math.PI * (j + 0.5)) / n
      const r = Math.sqrt(1 - z * z)
      // the grid is uniform in z (= cos θ): a solid angle of 2π / n² per cell
      sum += f([r * Math.cos(phi), r * Math.sin(phi), z]) * ((2 * Math.PI) / (n * n))
    }
  return sum
}

test('a diffuse surface sends back its colour: the weight is the albedo and the density the cosine’s', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  const s = surface(0.5, 0, 0.5)
  const b = ptPrepareBsdf(s, [0, 0, 1])
  assert.equal(b.diffuseProb, 1)
  const l: Vec3 = [0, 0.6, 0.8]
  const e = ptEvalMaterial(s, b, l, [1, 1])
  assert.ok(Math.abs(e.weight[0] - 0.5) < 1e-6)
  assert.ok(Math.abs(e.pdf - 0.8 / Math.PI) < 1e-6)
})

test('where the vertex normal leans away from the shading normal, the diffuse lobe is softened toward the terminator and not elsewhere', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  const flat = surface(0.5, 0, 0.5)
  const leaning: Surface = { ...flat, vertexNormal: [Math.sin(0.6), 0, Math.cos(0.6)] }
  const b = ptPrepareBsdf(flat, [0, 0, 1])
  const toward: Vec3 = [Math.sin(1.2), 0, Math.cos(1.2)]
  const away: Vec3 = [-Math.sin(1.2), 0, Math.cos(1.2)]
  const near = ptEvalMaterial(leaning, b, toward, [1, 1])
  const far = ptEvalMaterial(leaning, b, away, [1, 1])
  const plain = ptEvalMaterial(flat, b, toward, [1, 1])
  assert.ok(Math.abs(plain.weight[0] - 0.5) < 1e-6)
  assert.ok(far.weight[0] < near.weight[0] && near.weight[0] <= 0.5 + 1e-6)
  assert.equal(far.weight[0], 0)
})

test('a light’s share of the diffuse lobe scales it', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  const s = surface(0.5, 0, 0.5)
  const b = ptPrepareBsdf(s, [0, 0, 1])
  assert.ok(Math.abs(ptEvalMaterial(s, b, [0, 0.6, 0.8], [0.5, 1]).weight[0] - 0.25) < 1e-6)
  assert.equal(ptEvalMaterial(s, b, [0, 0.6, 0.8], [0, 1]).weight[0], 0)
})

test('a smooth mirror-like metal keeps (about) all it receives, a rough one too: the lobes, with the energy restored, integrate to one', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  for (const roughness of [0.3, 0.6, 0.9]) {
    const s = surface(0, 1, roughness)
    const b = ptPrepareBsdf(s, [0.0, 0.0, 1.0])
    const albedo = hemisphere((l) => {
      const e = ptEvalMaterial(s, b, l, [1, 1])
      return e.weight[0] * e.pdf
    })
    assert.ok(albedo > 0.85 && albedo < 1.05, `roughness ${roughness}: ${albedo}`)
  }
})

test('a surface never sends back more than it receives', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  for (const [diffuse, f0, roughness] of [
    [0.9, 0.04, 0.5],
    [1, 0.08, 0.2],
    [0.3, 0.5, 0.7],
  ] as const) {
    const s = surface(diffuse, f0, roughness)
    for (const v of [
      [0, 0, 1],
      [0.6, 0, 0.8],
      [0.9, 0, Math.sqrt(1 - 0.81)],
    ] as Vec3[]) {
      const b = ptPrepareBsdf(s, v)
      const albedo = hemisphere((l) => {
        const e = ptEvalMaterial(s, b, l, [1, 1])
        return e.weight[0] * e.pdf
      })
      assert.ok(albedo <= 1.02, `${diffuse} ${f0} ${roughness} ${v}: ${albedo}`)
    }
  }
})

test('a direction drawn from the surface has the density the evaluation gives it, and the mean of the weights drawn is the albedo the evaluation integrates to', () => {
  const { ptPrepareBsdf, ptEvalMaterial, ptSampleMaterial } = material()
  const s = surface(0.6, 0.04, 0.5)
  const b = ptPrepareBsdf(s, [0.3, 0.1, Math.sqrt(1 - 0.1)])
  const albedo = hemisphere((l) => {
    const e = ptEvalMaterial(s, b, l, [1, 1])
    return e.weight[0] * e.pdf
  })
  let total = 0
  const n = 48
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (const k of [0.2, 0.7]) {
        const sample = ptSampleMaterial(s, b, [(i + 0.5) / n, (j + 0.5) / n, k])
        if (sample.pdf > 0) {
          total += sample.weight[0]
          const evaluated = ptEvalMaterial(s, b, sample.direction, [1, 1])
          assert.ok(Math.abs(evaluated.pdf - sample.pdf) <= sample.pdf * 1e-3)
        }
      }
  const mean = total / (n * n * 2)
  assert.ok(Math.abs(mean - albedo) < 0.05 * albedo, `${mean} against ${albedo}`)
})

test('a cloth’s fuzz takes a share of the lobes by its colour, and the lobes under it keep what it leaves', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  const bare = surface(0.5, 0.04, 0.5)
  const cloth = { ...bare, fuzz: 0.8, fuzzColor: [1, 1, 1] as Vec3 }
  const b = ptPrepareBsdf(cloth, [0, 0, 1])
  const fuzzProb = 1 - b.diffuseProb - b.specProb
  assert.ok(fuzzProb > 0.1 && fuzzProb < 1)
  const without = ptEvalMaterial(bare, ptPrepareBsdf(bare, [0, 0, 1]), [0, 0.6, 0.8], [1, 1])
  const with_ = ptEvalMaterial(cloth, b, [0, 0.6, 0.8], [1, 1])
  assert.ok(with_.weight[0] > 0 && with_.pdf > 0 && with_.weight[0] !== without.weight[0])
})

test('a cloth never sends back more than it receives, fuzz included', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  const s = { ...surface(0.7, 0.04, 0.6), fuzz: 1, fuzzColor: [1, 1, 1] as Vec3 }
  for (const v of [
    [0, 0, 1],
    [0.6, 0, 0.8],
  ] as Vec3[]) {
    const b = ptPrepareBsdf(s, v)
    const albedo = hemisphere((l) => {
      const e = ptEvalMaterial(s, b, l, [1, 1])
      return e.weight[0] * e.pdf
    })
    assert.ok(albedo <= 1.05 && albedo > 0.5, `${v}: ${albedo}`)
  }
})

test('a glass sends the light that reaches it on both sides, a refraction moving the ray to the other side of the surface', () => {
  const { ptPrepareBsdf, ptSampleMaterial, ptEvalMaterial } = material()
  const s = { ...surface(0, 0.04, 0.3), glass: true }
  const b = ptPrepareBsdf(s, [0, 0, 1])
  let refracted = 0
  let reflected = 0
  const n = 32
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (const k of [0.01, 0.5, 0.9]) {
        const sample = ptSampleMaterial(s, b, [(i + 0.5) / n, (j + 0.5) / n, k])
        if (!(sample.pdf > 0)) continue
        const below = sample.direction[2] < 0
        if (below) refracted++
        else reflected++
        assert.equal(sample.scatter, below ? 3 : 2)
        const evaluated = ptEvalMaterial(s, b, sample.direction, [1, 1])
        assert.ok(
          Math.abs(evaluated.pdf - sample.pdf) <= sample.pdf * 2e-3,
          `${evaluated.pdf} ${sample.pdf}`,
        )
      }
  assert.ok(refracted > reflected && reflected > 0, `${refracted} ${reflected}`)
})

test('a glass keeps the light: what a smooth one reflects and refracts adds to about one', () => {
  const { ptPrepareBsdf, ptSampleMaterial } = material()
  const s = { ...surface(0, 0.04, 0.2), glass: true }
  const b = ptPrepareBsdf(s, [0, 0, 1])
  let total = 0
  const n = 64
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const sample = ptSampleMaterial(s, b, [
        (i + 0.5) / n,
        (j + 0.5) / n,
        ((i * 7 + j * 3) % 16) / 16 + 1 / 32,
      ])
      if (sample.pdf > 0) total += sample.weight[0]
    }
  assert.ok(Math.abs(total / (n * n) - 1) < 0.15, String(total / (n * n)))
})

test('a thin glass bends nothing: the light it transmits leaves along the side it came from, the densities of the evaluation and the sample agree and the weights keep the light of a clear pane', () => {
  const { ptPrepareBsdf, ptSampleMaterial, ptEvalMaterial } = material()
  const s = { ...surface(0, 0.04, 0.2), glass: true, thin: true }
  const v: Vec3 = [0.3, 0, Math.sqrt(1 - 0.09)]
  const b = ptPrepareBsdf(s, v)
  let total = 0
  let through = 0
  const n = 48
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (const k of [0.05, 0.4, 0.7, 0.95]) {
        const sample = ptSampleMaterial(s, b, [(i + 0.5) / n, (j + 0.5) / n, k])
        if (!(sample.pdf > 0)) continue
        total += sample.weight[0]
        if (sample.direction[2] < 0) {
          through += sample.weight[0]
          assert.equal(sample.scatter, 3)
        }
        const evaluated = ptEvalMaterial(s, b, sample.direction, [1, 1])
        assert.ok(
          Math.abs(evaluated.pdf - sample.pdf) <= sample.pdf * 2e-3,
          `${evaluated.pdf} ${sample.pdf}`,
        )
      }
  const all = total / (n * n * 4)
  assert.ok(all > 0.85 && all < 1.15, String(all))
  assert.ok(through / total > 0.8, String(through / total))
})

test('a thin glass of a coloured medium transmits less than a clear one, and its scatter lights the far side', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  const clear = { ...surface(0.5, 0.04, 0.3), glass: true, thin: true }
  const dark = { ...clear, tint: [0.2, 0.2, 0.2] as Vec3 }
  const v: Vec3 = [0, 0, 1]
  const through = (s: Surface) =>
    hemisphere((l) => {
      const e = ptEvalMaterial(s, ptPrepareBsdf(s, v), [l[0], l[1], -l[2]], [1, 1])
      return e.weight[0] * e.pdf
    })
  assert.ok(through(dark) < through(clear), `${through(dark)} ${through(clear)}`)
  assert.ok(through(dark) > 0)
})

test('a surface picked among others carries the weight of the pick', () => {
  const { ptPrepareBsdf, ptEvalMaterial } = material()
  const s = { ...surface(0.5, 0, 0.5), selection: 2 }
  const b = ptPrepareBsdf(s, [0, 0, 1])
  assert.ok(Math.abs(ptEvalMaterial(s, b, [0, 0.6, 0.8], [1, 1]).weight[0] - 1) < 1e-6)
})

test('a two-sided leaf sends light through: the evaluation of the far side has the density the sample gives, and the transmitted share of the albedo is its colour', () => {
  const { ptPrepareBsdf, ptSampleMaterial, ptEvalMaterial } = material()
  const s = { ...surface(0.3, 0, 1), transmit: [0.5, 0.5, 0.5] as Vec3 }
  const b = ptPrepareBsdf(s, [0, 0, 1])
  assert.ok(Math.abs((b as Bsdf & { transmitProb: number }).transmitProb - 0.625) < 1e-6)
  let through = 0
  let front = 0
  const n = 48
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (const k of [0.2, 0.7]) {
        const sample = ptSampleMaterial(s, b, [(i + 0.5) / n, (j + 0.5) / n, k])
        if (!(sample.pdf > 0)) continue
        const evaluated = ptEvalMaterial(s, b, sample.direction, [1, 1])
        assert.ok(
          Math.abs(evaluated.pdf - sample.pdf) <= sample.pdf * 1e-3,
          `${evaluated.pdf} ${sample.pdf}`,
        )
        if (sample.direction[2] < 0) through += sample.weight[0]
        else front += sample.weight[0]
      }
  assert.ok(Math.abs(through / (n * n * 2) - 0.5) < 0.03, String(through / (n * n * 2)))
  assert.ok(Math.abs(front / (n * n * 2) - 0.3) < 0.03, String(front / (n * n * 2)))
})
