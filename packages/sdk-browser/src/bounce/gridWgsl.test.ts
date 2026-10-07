// Shared formulas: the Lambert 1/π constant and the order-2 spherical-harmonics basis are
// written once, and every shader that needs them carries that one text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_GRID_WGSL } from './gridWgsl.ts'
import { INVERSE_PI_BOUNCE } from '../../../math/src/wgsl/lighting.ts'
import { BOUNCE_APPLY_WGSL } from './applyWgsl.ts'
import { BOUNCE_SURFACE_SHADER } from './surfaceWgsl.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'
import { directLightingWgsl } from '../lighting/direct/lightingWgsl.ts'
import {
  irradianceShader,
  radianceProjectionShader,
} from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

const DIRECT_LIGHTING_WGSL = wgslModule(directLightingWgsl())
const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

test('INVERSE_PI_BOUNCE declares the 1/π the bounce passes always read, one ulp above 1/π', () => {
  const literal = /^const INVERSE_PI_BOUNCE:f32=([^;]+);$/.exec(INVERSE_PI_BOUNCE.text)?.[1]
  assert.ok(literal, INVERSE_PI_BOUNCE.text)
  // The f32 the passes' literal `0.31830989` named before the library wrote it, to the bit.
  assert.ok(Object.is(Math.fround(Number(literal)), Math.fround(0.31830989)))
  const words = new Uint32Array(new Float32Array([Number(literal), 1 / Math.PI]).buffer)
  assert.equal(words[0] - words[1], 1)
})

test('INVERSE_PI_BOUNCE appears once in the application and once in the surface cache', () => {
  assert.equal(occurrences(wgslModule(BOUNCE_APPLY_WGSL), INVERSE_PI_BOUNCE.text), 1)
  assert.equal(occurrences(BOUNCE_SURFACE_SHADER, INVERSE_PI_BOUNCE.text), 1)
})

test('every probe shader projects and evaluates the one order-2 basis', () => {
  // The bounce probes store their nine coefficients in the environment's band order: the pass
  // that fills them and the lookup that reads them compile the shared text, as does the scene
  // environment.
  const probeEvaluation = irradianceShader((k) => `probeAt(probe,${k}u).xyz`, 'n')
  assert.ok(wgslModule(BOUNCE_APPLY_WGSL).includes(probeEvaluation))
  assert.ok(BOUNCE_SURFACE_SHADER.includes(probeEvaluation))
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
      .replace(/max\(vec3f?\(0\.0\),/g, 'Math.max(0,') +
      (/\breturn\b/.test(body) ? '' : 'return E;'),
  ) as (c: number[], v: Vector) => number

const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from) + from.length
  return text.slice(start, text.indexOf(to, start))
}

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
    between(wgslSource(BOUNCE_GRID_WGSL), 'fn shIrradiance(probe:vec3u,n:vec3f)->vec3f{', '\n}'),
    /probeAt\(probe,(\d)u\)\.xyz/g,
    'n',
  )
  const environment = channel(
    between(DIRECT_LIGHTING_WGSL, 'let e=directLights.environment;', 'return'),
    /e\[(\d)\]\.rgb/g,
    'N',
  )
  const unit = (x: number, y: number, z: number) => {
    const length = Math.hypot(x, y, z)
    return { x: x / length, y: y / length, z: z / length }
  }
  const directions = [unit(1, 0, 0), unit(0, 1, 0), unit(0.3, -0.5, 0.8), unit(-2, 1, 1)]
  for (const source of directions) {
    const sh = project(source)
    for (const n of [...directions, unit(1, 2, -3)]) {
      const expected = bounce(sh, n),
        read = environment(sh, n)
      assert.ok(Math.abs(Math.max(0, read) - expected) < 1e-5, `${expected} vs ${read}`)
    }
  }
})
