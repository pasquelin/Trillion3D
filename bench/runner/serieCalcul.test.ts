// Batch computation path, from command line to metrics: `--chemin-math` arrives as
// is at page explorer, `auto` enforces nothing, and `runSerie` publishes governor metrics
// without ever assuming a path that the measured dist did not publish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOptions } from './options.ts';
import { runSerie } from './serie.ts';
import type { Page } from 'playwright';
import type { RunContext } from './report/types.ts';
import type { Side } from './optionsCote.ts';
import type { CameraPose } from '../../packages/sdk-core/src/index.ts';

/** What the page returns when it has nothing more to say than requested metrics. */
const releveDePage = (mathBatch: unknown) => ({
  cpuFrameMs: [],
  cpuSelectMs: [],
  gpuFrameMs: [],
  stageProfile: null,
  selection: { source: null, ids: [] },
  metrics: {},
  size: { width: 8, height: 8 },
  lost: [],
  captureStatus: 200,
  ...(mathBatch === undefined ? {} : { mathBatch }),
});

const pose: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], fov: 55, near: 0.1, far: 100 };

/** A series run on a mock page: returns produced row and path it received. */
async function serie(mathPath: string, mathBatch: unknown) {
  const OUT = await mkdtemp(join(tmpdir(), 'wg-serie-calcul-'));
  const recus: unknown[] = [];
  const page = {
    evaluate: async (_fn: unknown, payload: { mathPath: unknown }) => {
      recus.push(payload.mathPath);
      return releveDePage(mathBatch);
    },
  } as unknown as Page;
  const ctx: RunContext = {
    MANIFEST: 'manifest.json',
    OUT,
    settings: {
      frames: 4,
      warmup: 1,
      maxPages: 32,
      width: 8,
      height: 8,
      mathPath,
    } as RunContext['settings'],
    lights: null,
    poses: null,
  };
  const side = {
    name: 'a',
    dist: 'dist-test',
    from: 'test',
    engine: {
      backend: 'creerMoteur',
      id: 'moteur-test',
      flags: [],
      page: 'pageEclairage.ts',
      source: 'cache',
    },
    variant: null,
    errorMetric: null,
  } as unknown as Side;
  try {
    const { row } = await runSerie(ctx, page, side, 'salon', 1, pose, new Map());
    return { row, recus };
  } finally {
    await rm(OUT, { recursive: true, force: true });
  }
}

test('--chemin-math: validated, `auto` by default, and unknown value rejected', () => {
  assert.equal(readOptions([], '/tmp/racine').settings.mathPath, 'auto');
  assert.equal(readOptions(['--chemin-math', 'wasm'], '/tmp/racine').settings.mathPath, 'wasm');
  assert.equal(readOptions(['--chemin-math', 'js'], '/tmp/racine').settings.mathPath, 'js');
  assert.throws(
    () => readOptions(['--chemin-math', 'rust'], '/tmp/racine'),
    /--chemin-math must be auto, js or wasm/,
  );
});

test('an enforced path reaches the page, and governor metrics are published as is', async () => {
  const gouverneur = { contract: 1, mode: 'wasm', wasmAvailable: true, operations: {} };
  const { row, recus } = await serie('wasm', gouverneur);
  assert.deepEqual(recus, ['wasm']);
  assert.equal(row.cheminCalcul, gouverneur);
});

test('`auto` enforces nothing on explorer, and dist without governor publishes null', async () => {
  const { row, recus } = await serie('auto', undefined);
  assert.deepEqual(recus, [null], 'auto leaves governor to arbitrate');
  assert.equal(row.cheminCalcul, null, 'unmeasured, not "JavaScript path"');
});
