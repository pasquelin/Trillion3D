// Computation path table (`summaryCompute.ts`): publishes what the governor chose,
// operation by operation, and never replaces an unmeasured median with a zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cheminsCalcul } from './summaryCompute.ts';
import type { MathBatch, MathOperation } from './summaryCompute.ts';
import type { Report, Row } from './report/types.ts';

/** A report reduced to what `cheminsCalcul` reads: one series, one side, its metrics. */
const rapport = (cheminCalcul: MathBatch | null): Report => ({
  startedAt: 't0',
  provenance: { machine: null, browser: null, displayCapHz: null },
  campaignIdentity: null,
  commande: 'pnpm run mesure',
  head: 'abc123',
  scene: 'scene-test',
  engine: 'moteur-test',
  pathVersion: 1,
  settings: { frames: 8, warmup: 2, width: 640, height: 360 } as Report['settings'],
  flags: [],
  ressources: null,
  sides: {},
  finishedAt: 't1',
  errors: [],
  series: [
    {
      view: 'salon',
      pixelError: 1,
      segment: 'segment-test',
      index: 0,
      pose: { position: [0, 0, 0], target: [0, 0, 0], fov: 55, near: 0.1, far: 100 },
      sides: { a: { cheminCalcul } as Partial<Row> as Row },
    },
  ],
});

/** Governor metrics, completed by what the case wants to show. */
const releve = (fields: Partial<MathBatch>): MathBatch =>
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
  }) as MathBatch;

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
});

test('the chosen path and both medians are published, operation by operation', () => {
  const lignes = cheminsCalcul(
    rapport(
      releve({
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
  ).join('\n');
  assert.match(
    lignes,
    /\| auto \| loaded, simd128 \| hierarchyUpdateBatch \| wasm \| 41\.3 \| 12\.5 \| 1 \| 4096 \|/,
  );
});

test('an unmeasured median is stated as "unmeasured", never zero, and the fallback cause is published', () => {
  const lignes = cheminsCalcul(
    rapport(
      releve({
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
  ).join('\n');
  assert.match(
    lignes,
    /\| js \| WebAssembly module unavailable \| boxTransformBatch \| js \| 30\.0 \| unmeasured \| 0 \| 12 \|/,
  );
});

test('a clock too coarse to arbitrate is published with the module, not killed', () => {
  const lignes = cheminsCalcul(rapport(releve({ clockCoarse: true }))).join('\n');
  assert.match(
    lignes,
    /\| auto \| loaded, simd128, clock too coarse to arbitrate \| no batch run \|/,
  );
});

test('a side without metrics says so, instead of implying the JavaScript path', () => {
  assert.match(cheminsCalcul(rapport(null)).join('\n'), /\| reading missing from this dist \|/);
});
