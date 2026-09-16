// Le chemin de calcul en lot, de la ligne de commande jusqu'au relevé : `--chemin-math` arrive tel
// quel à l'explorateur de la page, `auto` n'impose rien, et `runSerie` publie le relevé du
// gouverneur sans jamais supposer un chemin que le dist mesuré n'a pas publié.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOptions } from './options.mjs';
import { runSerie } from './serie.mjs';

/** Ce que la page rend quand elle n'a rien à dire de plus que le relevé demandé. */
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

/** Une série jouée sur une page de doublure : rend la ligne produite et le chemin qu'elle a reçu. */
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

test('--chemin-math : validé, `auto` par défaut, et une valeur inconnue refusée', () => {
  assert.equal(readOptions([], '/tmp/racine').settings.mathPath, 'auto');
  assert.equal(readOptions(['--chemin-math', 'wasm'], '/tmp/racine').settings.mathPath, 'wasm');
  assert.equal(readOptions(['--chemin-math', 'js'], '/tmp/racine').settings.mathPath, 'js');
  assert.throws(
    () => readOptions(['--chemin-math', 'rust'], '/tmp/racine'),
    /--chemin-math doit valoir auto, js ou wasm/,
  );
});

test('un chemin imposé arrive jusqu’à la page, et le relevé du gouverneur est publié tel quel', async () => {
  const gouverneur = { contract: 1, mode: 'wasm', wasmAvailable: true, operations: {} };
  const { row, recus } = await serie('wasm', gouverneur);
  assert.deepEqual(recus, ['wasm']);
  assert.equal(row.cheminCalcul, gouverneur);
});

test('`auto` n’impose rien à l’explorateur, et un dist sans gouverneur publie null', async () => {
  const { row, recus } = await serie('auto', undefined);
  assert.deepEqual(recus, [null], 'auto laisse le gouverneur arbitrer');
  assert.equal(row.cheminCalcul, null, 'non mesuré, et non pas « chemin JavaScript »');
});
