// The lit passes' light terms with the anisotropic and clear-coat lobes (`lobesWgsl.ts`) on a real
// GPU, through the shipped `directLightingWgsl` (`resolveHarness.ts`): on a pixel without lobes it
// sums what the program without lobe code sums, bit for bit — the program an image with a lobed
// surface takes changes no other pixel —, and so does a pixel whose lobes are on with neither a
// strength nor a coat; its anisotropic lobe at a strength whose αt rounds to α is the isotropic GGX
// lobe, to the rounding of its other form.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/lobes-resolve.gpu.ts
import { fromF32Bits } from '../../../packages/math/src/float/bits.ts'
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../packages/sdk-core/src/scene/light/contracts.ts'
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

/** A sun and point lights around the samples, each reaching them, none with a size: a sun's disk widens the
 *  isotropic lobe and wraps its cosine where the anisotropic lobe takes the wrap alone, as the reference's
 *  anisotropic branch skips the sphere's widening, so the two forms are one
 *  lobe only for a point of light (a sun of angular radius 0). */
const lights: SceneLight[] = [
  {
    id: 'sun',
    kind: 'directional',
    direction: unit([0.2, -1, 0.4]),
    color: [1, 0.95, 0.9],
    intensity: 2,
    castsShadow: false,
    angularRadius: 0,
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
const record = (
  name: string,
  lobes?: 'main' | 'zeroLobes' | 'isoAniso' | 'exactZero' | 'exactAniso',
) => ({
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
      record('exactZero', 'exactZero'),
      record('exactAniso', 'exactAniso'),
    ],
  },
]

let sums: Record<string, number[]> = {}
before(async () => {
  sums = Object.assign({}, ...(await runResolves(SCENES)))
  assert.equal(Object.keys(sums).length, 6, 'every record summed')
})

test('the lobes program sums a pixel without lobes as the program without lobe code, bit for bit', () => {
  assertSameBits(sums.lobeProgram, sums.standard, 'a pixel without lobes')
  assertSameBits(sums.zeroLobes, sums.standard, 'lobes on, no strength and no coat')
  const lit = points.filter((_, k) => sums.standard.slice(4 * k, 4 * k + 3).some(Boolean))
  assert.ok(lit.length > 96, `the samples are lit: ${lit.length}`)
})

/** The samples whose view is not behind their normal: both forms clamp N·V there, differently. */
const seen = (k: number) => {
  const at = k * SAMPLE_FLOATS,
    N = unit(samples.slice(at + 4, at + 7)),
    V = unit(samples.slice(at + 12, at + 15))
  return N[0] * V[0] + N[1] * V[1] + N[2] * V[2] >= 0.05
}

/** The largest relative gap, over the seen samples' channels, between two records' sums. */
function widestGap(a: number[], b: number[]) {
  let widest = 0,
    compared = 0
  for (let k = 0; k < points.length; k++) {
    if (!seen(k)) continue
    for (let c = 0; c < 3; c++) {
      const x = fromF32Bits(a[4 * k + c]),
        y = fromF32Bits(b[4 * k + c])
      widest = Math.max(widest, Math.abs(x - y) / Math.max(1, Math.abs(y)))
      compared++
    }
  }
  return { widest, compared }
}

test('the anisotropic lobe at αt = α is the isotropic GGX lobe, both with the exact visibility', () => {
  const { widest, compared } = widestGap(sums.exactAniso, sums.exactZero)
  assert.ok(widest <= 1e-4, `widest gap ${widest}`)
  assert.ok(compared > 90, `${compared} channels compared`)
})

test('the round lobe takes the visibility approximation unless the exact one is on; the anisotropic lobe is always exact', () => {
  // The anisotropic lobe's visibility is its exact lengths whatever the switch says.
  assert.ok(
    widestGap(sums.isoAniso, sums.exactAniso).widest <= 1e-6,
    'the anisotropic lobe ignores the switch',
  )
  // The round lobe's approximation is a different visibility: the two differ past the tolerance that holds
  // two equal lobes equal (1e-4, above), the difference shown, not masked.
  assert.ok(
    widestGap(sums.isoAniso, sums.zeroLobes).widest > 1e-4,
    'the approximation differs from the exact visibility',
  )
})
