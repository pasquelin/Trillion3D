// Shared formulas: the Lambert 1/π constant is written once, and every shader that needs it carries that one text; the cell addresses
// the mark pass names.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MARK_IMAGE_SHADER } from './pool/poolMarkWgsl.ts'
import { POOL_MARK_WORDS } from './pool/poolLayout.ts'
import { markedCells } from './pool/pool.fixture.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { BOUNCE_APPLY_WGSL } from './applyWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

test('the bounce passes read the one Lambert 1/π of the direct term', () => {
  assert.equal(occurrences(wgslModule(BOUNCE_APPLY_WGSL), INVERSE_PI.text), 1)
})

test('a pixel the screen probes did not read has the sky light’s diffuse light, none where no sky light shines', () => {
  // A sky light shining, its diffuse light of irradiance (0.5, 0.25, 0.125) on every normal: the cube
  // and harmonics are the program's own bindings (`skyLightIrradiance`), read here as a function.
  let shining = true
  const { indirectIrradiance, environmentSky } = shaderRun<{
    indirectIrradiance: (P: number[], N: number[]) => number[]
    environmentSky: (N: number[]) => number[]
  }>(wgslModule(BOUNCE_APPLY_WGSL), ['indirectIrradiance', 'environmentSky'], {
    skyLightApplied: () => shining,
    skyLightIrradiance: () => [0.5, 0.25, 0.125],
  })
  const P = [1, 2, 3],
    N = [0, 1, 0]
  assert.deepEqual(indirectIrradiance(P, N), [0.5, 0.25, 0.125])
  // The environment adds none of it beside the screen probes' light: a program that reads them never counts it twice.
  assert.deepEqual(environmentSky(N), [0, 0, 0])
  // No light shining (no cube ready, or the view's sky lighting off): none at all.
  shining = false
  assert.deepEqual(indirectIrradiance(P, N), [0, 0, 0])
})

test('the sky light is the environment’s where no screen probe is read, the screen probes’ and the sky light’s own where they are', () => {
  const direct = contractLightingShader(false),
    probed = contractLightingShader(true)
  // The program with no probes adds the sky light beside the environment, the sky nothing hides...
  assert.match(direct, /fn environmentSky\(N:vec3f\)->vec3f\{return skyIrradiance\(N\);\}/)
  // ...the one that reads them takes it from them, and adds none beside them.
  assert.match(probed, /fn environmentSky\(N:vec3f\)->vec3f\{return vec3f\(0\.0\);\}/)
  assert.ok(probed.includes('fn indirectIrradiance('))
  assert.ok(!probed.includes('probeAt') && !probed.includes('cellTable'), 'no world probe is read')
})

/**
 * The mark pass over the image (`MARK_IMAGE_SHADER`) run as the shipped text over an image of 64 × 64 pixels, each
 * tile — 16 pixels a side — reading one surface point `P` of normal up: its bitmap decoded cell by cell, the cells it names are the
 * eight probes the lit passes read for the point.
 */
function marked(
  P: number[],
  { depth = 0.5, normal = [0, 1, 0, 0.5] }: { depth?: number; normal?: number[] } = {},
) {
  const cascades = createBounceCascades([-2000, -10, -2000, 2000, 100, 2000])
  cascades.follow([0, 1.7, 0])
  const bits = new Uint32Array(POOL_MARK_WORDS)
  const run = shaderRun<{ markImage: (tile: number[]) => void }>(MARK_IMAGE_SHADER, ['markImage'], {
    bounce: {
      counts: [cascades.size, cascades.levels.length, cascades.cells, cascades.probes],
      frame: [1, 0, 5, 0],
      levels: cascades.levels.map(({ base, spacing }) => ({ base, spacing })),
    },
    view: { viewport: [64, 64, 0, 0] },
    sceneDepth: { load: () => depth },
    sceneNormals: { load: () => normal },
    worldAt: () => P,
    marks: bits,
  })
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) run.markImage([x, y, 0])
  return { cells: markedCells(cascades, bits), cascades }
}

test('the mark pass names the eight probes around each surface the image shows, at the finest level that holds it', () => {
  const P = [10.2, 0.3, -4.7]
  const { cells, cascades } = marked(P)
  const spacing = cascades.levels[0].spacing
  // The point the lit passes read: a step of the normal bias off the surface, the corner a half cell back.
  const corner = [P[0], P[1] + BOUNCE_SETTINGS.normalBias * spacing, P[2]].map((v) =>
    Math.floor(v / spacing - 0.5),
  )
  const expected = Array.from({ length: 8 }, (_, k) => [
    corner[0] + (k & 1),
    corner[1] + ((k >> 1) & 1),
    corner[2] + ((k >> 2) & 1),
  ])
  assert.deepEqual(
    cells.map((entry) => entry.level),
    new Array(8).fill(0),
  )
  assert.deepEqual(
    cells.map((entry) => entry.cell.join()).sort(),
    expected.map((c) => c.join()).sort(),
  )
  // Past the first level's 25 m the second answers, with its own cells; then the third, and the fourth.
  const far = marked([40, 0.3, 0])
  assert.ok(far.cells.length === 8 && far.cells.every((entry) => entry.level === 1))
  assert.ok(marked([80, 0.3, 0]).cells.every((entry) => entry.level === 2))
  assert.ok(marked([150, 0.3, 0]).cells.every((entry) => entry.level === 3))
  // Past every level, or at sky, or where the image holds no normal, nothing is read: the sky light answers.
  assert.deepEqual(marked([900, 0.3, 0]).cells, [])
  assert.deepEqual(marked(P, { depth: 0 }).cells, [], 'reverse depth: zero is the background')
  assert.deepEqual(marked(P, { normal: [0, 0, 0, 0] }).cells, [])
})
