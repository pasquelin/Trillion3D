// Shared formulas: the Lambert 1/π constant and the order-2 spherical-harmonics basis are
// written once, and every shader that needs them carries that one text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_GRID_WGSL } from './gridWgsl.ts'
import { BOUNCE_MARK_SHADER } from './markWgsl.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { createProbePool } from '../../../../sdk-core/src/bounce/probePool.ts'
import { applyMarks, markWords } from '../../../../sdk-core/src/bounce/probeMarks.ts'
import { functionBody } from '../../materials/texture/shaderRule.fixture.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { BOUNCE_APPLY_WGSL } from './applyWgsl.ts'
import { surfaceRayWgsl } from './surfaceRayWgsl.ts'
import { BOUNCE_PROBE_SHADER } from './probes/probeWgsl.ts'
import { directLightingWgsl } from '../direct/lightingWgsl.ts'
import {
  irradianceShader,
  radianceProjectionShader,
} from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { unit } from '../../../../math/src/vector/vectorTuple.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'

const DIRECT_LIGHTING_WGSL = wgslModule(directLightingWgsl())
const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

test('the bounce passes read the one Lambert 1/π of the direct term', () => {
  assert.equal(occurrences(wgslModule(BOUNCE_APPLY_WGSL), INVERSE_PI.text), 1)
  assert.equal(occurrences(wgslModule(surfaceRayWgsl()), INVERSE_PI.text), 1)
})

test('every probe shader projects and evaluates the one order-2 basis', () => {
  // The bounce probes store their nine coefficients in the environment's band order: the pass
  // that fills them and the lookup that reads them compile the shared text, as does the scene
  // environment.
  const probeEvaluation = irradianceShader((k) => `probeAt(probe,${k}u).xyz`, 'n')
  assert.ok(wgslModule(BOUNCE_APPLY_WGSL).includes(probeEvaluation))
  assert.ok(
    BOUNCE_PROBE_SHADER.includes(radianceProjectionShader((k) => `sums[${k}]`, 'sample.rgb', 'd')),
  )
  assert.ok(DIRECT_LIGHTING_WGSL.includes(irradianceShader((k) => `e[${k}].rgb`, 'N')))
})

type Vector = { x: number; y: number; z: number }

/** A shader expression run on the CPU for one colour channel: coefficient `k` read as `c[k]`. */
const channel = (body: string, coefficient: RegExp, vector: string) =>
  new Function(
    'c',
    vector,
    body
      .replace(coefficient, (_, k: string | undefined) => `c[${k ?? 0}]`)
      .replace(/\b(var|let) (\w+)=/g, 'let $2=')
      .replace(/\bmax\(/g, 'Math.max(')
      .replace(/vec3f?\(0\.0\)/g, '0') + (/\breturn\b/.test(body) ? '' : 'return E;'),
  ) as (c: number[], v: Vector) => number

test('a bounce probe is read in the band order the environment uses', () => {
  // Run on the shader text itself, not on the shared basis: the coefficients the probe pass
  // writes for one ray, then the bounce lookup and the environment reading them must agree on
  // every normal.
  const terms = [...BOUNCE_PROBE_SHADER.matchAll(/sums\[(\d)\]\+=sample\.rgb\*(.+);/g)]
  assert.equal(terms.length, 9)
  const project = (d: Vector) => {
    const sh = new Array<number>(9).fill(0)
    for (const [, k, term] of terms) sh[Number(k)] = new Function('d', `return ${term};`)(d)
    return sh
  }
  const bounce = channel(
    functionBody(BOUNCE_GRID_WGSL, 'shIrradiance'),
    /probeAt\(probe,(\d)u\)\.xyz/g,
    'n',
  )
  // The environment's reading: its irradiance past the line naming its coefficients.
  const environment = channel(
    functionBody(DIRECT_LIGHTING_WGSL, 'environmentIrradiance').replace(
      'let e=directLights.environment;',
      '',
    ),
    /e\[(\d)\]\.rgb/g,
    'N',
  )
  const [a, b, c, d, e] = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0.3, -0.5, 0.8],
      [-2, 1, 1],
      [1, 2, -3],
    ] as [number, number, number][]
  ).map((v) => {
    const [x, y, z] = unit(v)
    return { x, y, z }
  })
  const directions = [a, b, c, d]
  for (const source of directions) {
    const sh = project(source)
    for (const n of [...directions, e]) {
      const expected = bounce(sh, n),
        read = environment(sh, n)
      assert.ok(Math.abs(read - expected) < 1e-5, `${expected} vs ${read}`)
    }
  }
})

test('the probes carry the sky where they answer; the sky light’s own diffuse light stands for the rest', () => {
  // A sky light shining, its diffuse light of irradiance (0.5, 0.25, 0.125) on every normal: the cube
  // and harmonics are the program's own bindings (`skyLightIrradiance`), read here as a function.
  let shining = true
  const { indirectGathered, environmentSky, skyIrradiance } = shaderRun<{
    indirectGathered: (gathered: number[], N: number[]) => number[]
    environmentSky: (N: number[]) => number[]
    skyIrradiance: (N: number[]) => number[]
  }>(wgslModule(BOUNCE_APPLY_WGSL), ['indirectGathered', 'environmentSky', 'skyIrradiance'], {
    skyLightApplied: () => shining,
    skyLightIrradiance: () => [0.5, 0.25, 0.125],
  })
  const N = [0, 1, 0],
    probes = [0.1, 0.2, 0.3]
  assert.deepEqual(indirectGathered([...probes, 1], N), probes, 'answered whole: the probes alone')
  const none = indirectGathered([0, 0, 0, 0], N)
  assert.ok(
    none.every((c, i) => Math.abs(c - [0.5, 0.25, 0.125][i]) < 1e-9),
    'none: the sky light',
  )
  const part = indirectGathered([...probes, 0.25], N)
  part.forEach((c, i) =>
    assert.ok(Math.abs(c - (0.75 * [0.5, 0.25, 0.125][i] + 0.25 * probes[i])) < 1e-9),
  )
  // No light shining (no cube ready, or the view's sky lighting off): no light below zero, none at all.
  shining = false
  assert.deepEqual(skyIrradiance([0, 1, 0]), [0, 0, 0])
  // The environment adds none of it beside them: a program that reads the probes never counts it twice.
  assert.deepEqual(environmentSky(N), [0, 0, 0])
})

test('a scene with no sky light is no darker for a partial read: the probes that answer stand for the rest', () => {
  // No sky light shines, and the pixel's environment (ambient, hemisphere) is its own
  // term beside the probes, so the share the probes leave has no unoccluded light of its own to take.
  const { indirectGathered } = shaderRun<{
    indirectGathered: (gathered: number[], N: number[]) => number[]
  }>(wgslModule(BOUNCE_APPLY_WGSL), ['indirectGathered'], { skyLightApplied: () => false })
  const N = [0, 1, 0],
    probes = [0.1, 0.2, 0.3]
  assert.deepEqual(indirectGathered([...probes, 1], N), probes, 'answered whole')
  assert.deepEqual(indirectGathered([...probes, 0.25], N), probes, 'a quarter answered: their mean')
  assert.deepEqual(indirectGathered([0, 0, 0, 0], N), [0, 0, 0], 'none: nothing, as with no probes')
})

test('the sky light is the environment’s where no probe is read, the probes’ where they are', () => {
  const direct = contractLightingShader(false),
    probed = contractLightingShader(true)
  // The program with no probes adds the sky light beside the environment, the sky nothing hides...
  assert.match(direct, /fn environmentSky\(N:vec3f\)->vec3f\{return skyIrradiance\(N\);\}/)
  assert.ok(!direct.includes('indirectGathered'))
  // ...the one that reads them takes it from them, and adds none beside them.
  assert.match(probed, /fn environmentSky\(N:vec3f\)->vec3f\{return vec3f\(0\.0\);\}/)
  assert.ok(probed.includes('fn indirectGathered('))
})

test('a surface a probe ray or a reflection hits is lit by what the probes hold there, never by the sky light', () => {
  // A bright sky light: the pixel's fallback where no probe answers (`indirectGathered`), never a hit's.
  let gathered = [0, 0, 0, 0]
  const { surfaceSeen, surfaceLit } = shaderRun<{
    surfaceSeen: (albedo: number[], P: number[], N: number[]) => number[]
    surfaceLit: (albedo: number[], P: number[], N: number[], reach: number) => number[]
  }>(wgslModule(surfaceRayWgsl()), ['surfaceSeen', 'surfaceLit'], {
    skyLightApplied: () => true,
    skyLightIrradiance: () => [0.5, 0.25, 0.125],
    sampleBounceGathered: () => gathered,
    // The lights add a unit of irradiance: only the indirect share is under test.
    lightsIrradiance: () => [1, 1, 1],
  })
  const albedo = [0.8, 0.4, 0.2],
    P = [0, 0, 0],
    N = [0, 1, 0]
  const lit = (irradiance: number[]) => albedo.map((c, i) => (c * irradiance[i]) / Math.PI)
  const near = (read: number[], want: number[]) =>
    read.forEach((c, i) => assert.ok(Math.abs(c - want[i]) < 1e-6, `${read} vs ${want}`))
  // No probe holds light yet: the surface holds none either, it fills as they do — the lights alone light it.
  near(surfaceSeen(albedo, P, N), lit([0, 0, 0]))
  near(surfaceLit(albedo, P, N, 10), lit([1, 1, 1]))
  // A share answered: the probes' light for that share, nothing for the rest.
  gathered = [0.1, 0.2, 0.3, 0.5]
  near(surfaceSeen(albedo, P, N), lit([0.05, 0.1, 0.15]))
  near(surfaceLit(albedo, P, N, 10), lit([1.05, 1.1, 1.15]))
  gathered = [0.1, 0.2, 0.3, 1]
  near(surfaceSeen(albedo, P, N), lit([0.1, 0.2, 0.3]))
})

/**
 * The mark pass (`BOUNCE_MARK_SHADER`) run as the shipped text over an image of 64 × 64 pixels, each
 * tile — 16 pixels a side — reading one surface point `P` of normal up: its bitmap decoded by the
 * pool's own reader (`applyMarks`), the cells it names are the eight probes the lit passes read for the point.
 */
function marked(
  P: number[],
  { depth = 0.5, normal = [0, 1, 0, 0.5] }: { depth?: number; normal?: number[] } = {},
) {
  const cascades = createBounceCascades([-2000, -10, -2000, 2000, 100, 2000])
  cascades.follow([0, 1.7, 0])
  const bits = new Uint32Array(markWords(cascades))
  const run = shaderRun<{ markCells: (tile: number[]) => void }>(
    BOUNCE_MARK_SHADER,
    ['markCells'],
    {
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
    },
  )
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) run.markCells([x, y, 0])
  const pool = createProbePool({ ...cascades, probes: 4096 })
  const cells: { level: number; cell: number[] }[] = []
  const bases = cascades.levels.flatMap((level) => level.base)
  applyMarks(bits, bases, cascades, pool, 1)
  pool.probes(2, [0, 1.7, 0], 4096, 4096, (_slot, level, x, y, z) =>
    cells.push({ level, cell: [x, y, z] }),
  )
  return { cells, cascades }
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
