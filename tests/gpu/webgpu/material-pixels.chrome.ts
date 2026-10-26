// What a material is worth on screen, in Chrome: every fixture of `materialFixtures.ts` — base
// colour and its map, MASK at its cutoff, BLEND over the background and over a surface, a map
// repeated and turned, nearest, anisotropic stripes, foliage at grazing angles, double- and
// single-sided back faces, rough and metal, emissive, normal-mapped — drawn by the WebGPU engine
// and read at the points that exercise its feature: the engine's frame held with its render
// diagnostics, no hole where a surface stands behind the fixture, and anisotropy 16 gaining
// contrast over 1.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mean } from '../../../packages/math/src/scalar/quantile.ts'
import { inChrome } from '../../kit/device/onChrome.ts'
import { ANISOTROPY_GAIN, fixtures } from './materialFixtures.ts'
import type { run } from './materialPixelsPage.ts'

const PAGE = resolve(import.meta.dirname, 'materialPixelsPage.ts')

test('every material fixture draws at its feature', { timeout: 600_000 }, async () => {
  const { results, errors, gpu } = await inChrome<Awaited<ReturnType<typeof run>>>(PAGE, 'run')
  console.log(JSON.stringify(results.map(({ name, holes, truth }) => ({ name, holes, truth }))))
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
    if (fixture.holes !== undefined)
      assert.equal(fixture.holes, 0, `${fixture.name}: ${fixture.holes} points show the background`)
  }
  // Anisotropy 16 against 1 on the grazing stripes: the engine must gain contrast.
  const spread = (name: string) => {
    const found = results.find((fixture) => fixture.name === name)
    assert.ok(found, `no fixture named ${name}`)
    const means = found.samples.map((sample) => mean(sample.engine))
    return Math.max(...means) - Math.min(...means)
  }
  const flat = spread('grazing stripes, anisotropy 1'),
    sharp = spread('grazing stripes, anisotropy 16')
  assert.ok(
    sharp - flat >= ANISOTROPY_GAIN,
    `anisotropy 16 spreads ${sharp} levels, anisotropy 1 ${flat}; ` +
      `at least ${ANISOTROPY_GAIN} more expected`,
  )
})
