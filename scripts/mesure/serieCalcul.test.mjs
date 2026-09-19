// Batch computation path, from command line to metrics: `--chemin-math` arrives as
// is at page explorer, `auto` enforces nothing, and `runSerie` publishes governor metrics
// without ever assuming a path that the measured dist did not publish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOptions } from './options.mjs';
import { runSerie } from './serie.mjs';

/** What the page returns when it has nothing more to say than requested metrics. */
const releveDePage = (mathBatch) => ({
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

/** A series run on a mock page: returns produced row and path it received. */
async function serie(mathPath, mathBatch) {
  const OUT = await mkdtemp(join(tmpdir(), 'wg-serie-calcul-'));
  const recus = [];
  const page = {
    evaluate: async (_fn, payload) => {
      recus.push(payload.mathPath);
      return releveDePage(mathBatch);
    },
  };
  const ctx = {
    MANIFEST: 'manifest.json',
    OUT,
    settings: { frames: 4, warmup: 1, maxPages: 32, width: 8, height: 8, mathPath },
    lights: null,
    poses: null,
  };
  try {
    const { row } = await runSerie(
      ctx,
      page,
      { name: 'a', engine: { backend: 'creerMoteur', id: 'moteur-test' } },
      'salon',
      1,
      { position: [0, 0, 0] },
      new Map(),
    );
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
