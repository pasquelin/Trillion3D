// The opaque resolve's program with the anisotropic and clear-coat lobes (`lobesWgsl.ts`) on a real
// GPU, through the shipped `directLightingWgsl` (`resolveHarness.ts`): on a pixel without lobes it
// sums what the program without lobe code sums, bit for bit — the program an image with a lobed
// surface takes changes no other pixel —, and so does a pixel whose lobes are on with neither a
// strength nor a coat; its anisotropic lobe at a strength whose αt rounds to α is the isotropic GGX
// lobe, to the rounding of its other form.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/lobes-resolve.gpu.ts
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'
import type { ResolveScene } from './resolvePage.ts'
import { SAMPLE_FLOATS } from './resolveHarness.ts'
import {
  assertSameBits,
  cellRecord,
  resolveRandom,
  resolveSamples,
  runResolves,
} from './resolveCases.ts'

const draw = resolveRandom(1471)
const { between, vector, unit } = draw
const { points, samples } = resolveSamples(128, draw)

/** A sun and point lights around the samples, each reaching them. */
const lights: SceneLight[] = [
  {
    id: 'sun',
    kind: 'directional',
    direction: unit([0.2, -1, 0.4]),
    color: [1, 0.95, 0.9],
    intensity: 2,
    castsShadow: false,
  },
  ...Array.from({ length: 6 }, (_, i): SceneLight => ({
    id: `l${i}`,
    kind: 'point',
    position: vector(2.5) as [number, number, number],
    color: [between(0.3, 1), between(0.3, 1), between(0.3, 1)],
    intensity: between(2, 20),
    range: 40,
    castsShadow: false,
  })),
]
const list = lights.map((_, rank) => rank)
const record = (name: string, lobes?: 'main' | 'zeroLobes' | 'isoAniso') => ({
  name,
  narrow: false,
  words: cellRecord(list),
  lobes,
})
const SCENES: ResolveScene[] = [
  {
    lights,
    samples,
    records: [
      record('standard'),
      record('lobeProgram', 'main'),
      record('zeroLobes', 'zeroLobes'),
      record('isoAniso', 'isoAniso'),
    ],
  },
]

let sums: Record<string, number[]> = {}
before(async () => {
  sums = Object.assign({}, ...(await runResolves(SCENES)))
  assert.equal(Object.keys(sums).length, 4, 'every record summed')
})

test('the lobes program sums a pixel without lobes as the program without lobe code, bit for bit', () => {
  assertSameBits(sums.lobeProgram, sums.standard, 'a pixel without lobes')
  assertSameBits(sums.zeroLobes, sums.standard, 'lobes on, no strength and no coat')
  const lit = points.filter((_, k) => sums.standard.slice(4 * k, 4 * k + 3).some(Boolean))
  assert.ok(lit.length > 96, `the samples are lit: ${lit.length}`)
})

test('the anisotropic lobe at αt = α is the isotropic GGX lobe', () => {
  const f32 = (bits: number) => new Float32Array(new Uint32Array([bits]).buffer)[0]
  let compared = 0
  for (let k = 0; k < points.length; k++) {
    const at = k * SAMPLE_FLOATS,
      N = unit(samples.slice(at + 4, at + 7)),
      V = unit(samples.slice(at + 12, at + 15))
    // A view behind its normal is no pixel: both forms clamp N·V there, differently.
    if (N[0] * V[0] + N[1] * V[1] + N[2] * V[2] < 0.05) continue
    for (let c = 0; c < 3; c++) {
      const iso = f32(sums.standard[4 * k + c]),
        aniso = f32(sums.isoAniso[4 * k + c])
      assert.ok(
        Math.abs(aniso - iso) <= 1e-4 * Math.max(1, Math.abs(iso)),
        `sample ${k}, channel ${c}: ${aniso} for ${iso}`,
      )
      compared++
    }
  }
  assert.ok(compared > 90, `${compared} channels compared`)
})
