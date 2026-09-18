import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { ensureTaaTargets } from './taaPrepare.ts';
import { DEFAULT_FRAME_BUDGET } from './webgpuPagesSetup.ts';
import { TAA_HISTORY_BYTES_PER_PIXEL } from './temporalAntialiasing.ts';
import { MEASURE_HEIGHT, MEASURE_WIDTH } from '../../test/appui/emeraldProvenance.mjs';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un moteur réduit à son budget, avec une passe temporelle factice qui note ses redimensionnements. */
function runtime(frameBudget = DEFAULT_FRAME_BUDGET) {
  const resized: number[][] = [],
    failures: string[] = [];
  const temporal = {
    frame: { hasHistory: true, stillFrames: 5 },
    resize(w: number, h: number) {
      resized.push([w, h]);
      return true;
    },
    dispose() {},
  };
  const rt = {
    setup: {
      gpuDevice: { limits: { maxTextureDimension2D: 8192 } },
      frameBudget,
      reserveHiz: true,
    },
    gpu: { temporal },
    capture: { secondaryCamera: undefined },
    capabilities: { unsupported: [] as string[] },
    diag: { diagnosticFailure: (phase: string) => failures.push(phase) },
  } as unknown as WebgpuPagesRuntime;
  return { rt, temporal, resized, failures };
}

// Le défaut que ce test attrape : à la résolution de relevé, les deux cibles d'historique faisaient
// dépasser le budget de 256 Mio (275 680 016 > 268 435 456, mesuré le 18 sept. 2026) et le moteur
// refusait de se préparer. Le budget par défaut doit admettre cette image, historique compris.
test('le budget par défaut admet la résolution de relevé avec les deux cibles d’historique', () => {
  const { rt, resized, temporal } = runtime();
  const base = checkFrameBudget(rt, MEASURE_WIDTH, MEASURE_HEIGHT);
  const history = ensureTaaTargets(rt, MEASURE_WIDTH, MEASURE_HEIGHT, base);
  assert.equal(history, MEASURE_WIDTH * MEASURE_HEIGHT * TAA_HISTORY_BYTES_PER_PIXEL);
  assert.ok(base + history <= DEFAULT_FRAME_BUDGET, `${base + history} octets au-dessus du budget`);
  assert.deepEqual(resized, [[MEASURE_WIDTH, MEASURE_HEIGHT]]);
  // Des cibles réallouées n'ont plus d'historique.
  assert.equal(temporal.frame.hasHistory, false);
  assert.equal(temporal.frame.stillFrames, 0);
});

test('l’historique qui ne tient pas fait partir la passe, nommément, jamais l’image', () => {
  const base = checkFrameBudget(runtime().rt, 1000, 1000);
  const { rt, failures } = runtime(base + 1);
  assert.equal(ensureTaaTargets(rt, 1000, 1000, base), 0);
  assert.equal(rt.gpu.temporal, undefined);
  assert.deepEqual(failures, ['temporal-antialiasing-unavailable']);
  assert.deepEqual(rt.capabilities.unsupported, ['temporal antialiasing', 'motion vectors']);
});

test('une capture de surfaces ne touche pas aux cibles d’historique de la vue', () => {
  const { rt, resized } = runtime();
  rt.capture.secondaryCamera = {} as never;
  assert.equal(
    ensureTaaTargets(rt, 64, 64, 0),
    0,
    'la réserve de la capture porte déjà l’historique',
  );
  assert.deepEqual(resized, []);
});
