// Computation path table (`summary/summaryCompute.ts`): publishes what the governor chose,
// operation by operation, and never replaces an unmeasured median with a zero.
import test from 'node:test'
import assert from 'node:assert/strict'
import { computePaths } from './summaryCompute.ts'
import type { MathBatch, MathOperation } from './summaryCompute.ts'
import type { Report, Row } from '../report/types.ts'
import { rapport as rapportDe } from './summaryTestFixtures.ts'

/** A report reduced to what `computePaths` reads: one series, one side, its metrics. */
const rapport = (mathBatch: MathBatch | null): Report => rapportDe({ mathBatch } as Partial<Row>)

/** Governor metrics, completed by what the case wants to show. */
const reading = (fields: Partial<MathBatch>): MathBatch =>
  ({
    contract: 1,
    mode: 'auto',
    wasmAvailable: true,
    wasmSimd: true,
    clockResolutionMs: 0.005,
    clockCoarse: false,
    unavailableReason: null,
    operations: {},
    ...fields,
  }) as MathBatch

/** An operation, completed by what the case wants to show. */
const operation = (fields: Partial<MathOperation>): MathOperation => ({
  path: 'wasm',
  jsNsPerElement: null,
  wasmNsPerElement: null,
  jsSamples: 0,
  wasmSamples: 0,
  switches: 0,
  elements: 0,
  ...fields,
})

test('the chosen path and both medians are published, operation by operation', () => {
  const lignes = computePaths(
    rapport(
      reading({
        operations: {
          hierarchyUpdateBatch: operation({
            path: 'wasm',
            jsNsPerElement: 41.25,
            wasmNsPerElement: 12.5,
            switches: 1,
            elements: 4096,
          }),
        },
      }),
    ),
  ).join('\n')
  assert.match(
    lignes,
    /\| auto \| loaded, simd128 \| hierarchyUpdateBatch \| wasm \| 41\.3 \| 12\.5 \| 1 \| 4096 \|/,
  )
})

test('an unmeasured median is stated as "unmeasured", never zero, and the fallback cause is published', () => {
  const lignes = computePaths(
    rapport(
      reading({
        mode: 'js',
        wasmAvailable: false,
        wasmSimd: null,
        clockCoarse: true,
        unavailableReason: 'WebAssembly module unavailable',
        operations: {
          boxTransformBatch: operation({ path: 'js', jsNsPerElement: 30, elements: 12 }),
        },
      }),
    ),
  ).join('\n')
  assert.match(
    lignes,
    /\| js \| WebAssembly module unavailable \| boxTransformBatch \| js \| 30\.0 \| unmeasured \| 0 \| 12 \|/,
  )
})

test('a coarse clock is published with the module, its timing pooled', () => {
  const lignes = computePaths(rapport(reading({ clockCoarse: true }))).join('\n')
  assert.match(lignes, /\| auto \| loaded, simd128, coarse clock, pooled timing \| no batch run \|/)
})

test('a side without metrics says so, instead of implying the JavaScript path', () => {
  assert.match(computePaths(rapport(null)).join('\n'), /\| reading missing from this dist \|/)
})
