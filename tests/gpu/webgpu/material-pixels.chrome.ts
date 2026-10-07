// What a material is worth on screen, in Chrome: every fixture of `materialFixtures.ts` — base
// colour and its map, MASK at its cutoff, BLEND over the background and over a surface, a map
// repeated and turned, nearest, anisotropic stripes, foliage at grazing angles, double- and
// single-sided back faces, rough and metal, emissive, normal-mapped — drawn by the witness, Three's
// WebGPU renderer, and by the WebGPU engine, and read at the points that exercise its feature:
// every gap within the fixture's declared window, the engine's frame held with its render
// diagnostics, no hole where the witness shows a surface, anisotropy 16 gaining contrast over 1 on
// each renderer, and no grazing fixture farther from its ground truth than the witness, give or
// take its tolerance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inChrome } from '../kit/onChrome.ts'
import { ANISOTROPY_GAIN, fixtures } from './materialFixtures.ts'
import { truthVerdict } from './groundTruth.ts'
import type { run } from './materialPixelsPage.ts'

const PAGE = resolve(import.meta.dirname, 'materialPixelsPage.ts')

test(
  'every material fixture matches its reference at its feature',
  { timeout: 600_000 },
  async () => {
    const { results, errors, gpu } = await inChrome<Awaited<ReturnType<typeof run>>>(PAGE, 'run')
    console.log(
      JSON.stringify(
        results.map(({ name, difference, samples, holes, truth }) => ({
          name,
          difference,
          gap: Math.max(...samples.map((s) => s.gap)),
          holes,
          truth,
        })),
      ),
    )
    assert.deepEqual(errors, [], `uncaptured GPU errors on ${gpu}`)
    assert.equal(results.length, fixtures.length, 'one reading per fixture')
    for (const fixture of results) {
      const phases = fixture.events.map((event) => event.phase)
      // `render-capabilities` is said only by a prepare that made the visibility buffer, the
      // engine's one draw path: one that cannot refuses by name.
      for (const phase of ['material-textures', 'render-capabilities', 'first-readback'])
        assert.ok(phases.includes(phase), `${fixture.name}: missing render diagnostic ${phase}`)
      assert.ok(
        !phases.some((phase) => /failed|gpu-device-lost/.test(phase)),
        `${fixture.name}: GPU failure diagnostic`,
      )
      assert.equal(fixture.held, true, `${fixture.name}: the engine image never settled`)
      if (fixture.holes !== undefined)
        assert.equal(
          fixture.holes,
          0,
          `${fixture.name}: ${fixture.holes} pixels show the background`,
        )
      const [least, most] = fixture.difference
      const [reference, read] = fixture.pair
      for (const { point, reference: expected, engine, gap } of fixture.samples)
        assert.ok(
          gap >= least && gap <= most,
          `${fixture.name} (${point}): ${reference} ${expected}, ${read} ${engine}, ` +
            `gap ${gap} outside ${least}–${most} (${fixture.reason})`,
        )
    }
    // Anisotropy 16 against 1 on the grazing stripes: each renderer must gain contrast.
    const spread = (name: string, side: 'reference' | 'engine') => {
      const found = results.find((fixture) => fixture.name === name)
      assert.ok(found, `no fixture named ${name}`)
      const means = found.samples.map(
        (sample) => sample[side].reduce((sum, c) => sum + c, 0) / sample[side].length,
      )
      return Math.max(...means) - Math.min(...means)
    }
    for (const side of ['reference', 'engine'] as const) {
      const flat = spread('grazing stripes, anisotropy 1', side),
        sharp = spread('grazing stripes, anisotropy 16', side)
      assert.ok(
        sharp - flat >= ANISOTROPY_GAIN,
        `${side}: anisotropy 16 spreads ${sharp} levels, anisotropy 1 ${flat}; ` +
          `at least ${ANISOTROPY_GAIN} more expected`,
      )
    }
    // The witness is not the truth: the engine no farther from it than the witness, give or take
    // the fixture's tolerance.
    for (const { name, truth } of results) {
      if (!truth || truth.tolerance === null) continue
      const failure = truthVerdict(truth.engine, truth.reference, truth.tolerance)
      assert.equal(failure, undefined, `${name}: ${failure}`)
    }
  },
)
