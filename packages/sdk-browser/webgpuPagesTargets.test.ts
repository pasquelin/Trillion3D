import test from 'node:test';
import assert from 'node:assert/strict';
import { frameTargetAllocation } from './webgpuPagesTargets.ts';
import { ensureTaaTargets } from './taaPrepare.ts';
import { frameTargetBytes } from './surfaceBuffer.ts';
import { TAA_HISTORY_BYTES_PER_PIXEL } from './temporalAntialiasing.ts';
import { MEASURE_HEIGHT, MEASURE_WIDTH } from '../../test/appui/emeraldProvenance.mjs';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un moteur réduit à ses cibles, avec une passe temporelle factice qui note ses redimensionnements. */
function runtime() {
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
      reserveHiz: true,
    },
    gpu: { temporal },
    capture: { secondaryCamera: undefined },
    capabilities: { unsupported: [] as string[] },
    diag: { diagnosticFailure: (phase: string) => failures.push(phase) },
  } as unknown as WebgpuPagesRuntime;
  return { rt, temporal, resized, failures };
}

// Le défaut que ce test attrape : un plafond de 288 Mio, relevé une fois sur ce Mac, refusait la 4K
// et le raster de calcul à 2496×1404 (`SURFACE_BUDGET: 415 Mo > 288 Mio`, 18 sept. 2026) sur une
// machine qui les tenait. Comme chez la référence, les cibles suivent la résolution : ce qu'elles
// coûtent est publié, et seule une taille que l'appareil ne sait pas faire est refusée.
test('les cibles suivent la résolution, historique compris : la 4K est admise et chiffrée', () => {
  const { rt, resized, temporal } = runtime();
  for (const [width, height] of [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ]) {
    const base = frameTargetAllocation(rt, width, height);
    assert.equal(base, frameTargetBytes(width, height, true));
    assert.equal(ensureTaaTargets(rt, width, height), width * height * TAA_HISTORY_BYTES_PER_PIXEL);
  }
  assert.ok(
    frameTargetBytes(3840, 2160, true) > 288 * 1024 * 1024,
    'la 4K dépasse l’ancien plafond',
  );
  assert.deepEqual(resized, [
    [MEASURE_WIDTH, MEASURE_HEIGHT],
    [3840, 2160],
  ]);
  // Des cibles réallouées n'ont plus d'historique.
  assert.equal(temporal.frame.hasHistory, false);
  assert.equal(temporal.frame.stillFrames, 0);
  assert.throws(() => frameTargetAllocation(rt, 8193, 16), /SURFACE_DEVICE_LIMIT/);
});

test('une capture de surfaces ne touche pas aux cibles d’historique de la vue', () => {
  const { rt, resized } = runtime();
  rt.capture.secondaryCamera = {} as never;
  assert.equal(ensureTaaTargets(rt, 64, 64), 0, 'la réserve de la capture porte déjà l’historique');
  assert.deepEqual(resized, []);
});
