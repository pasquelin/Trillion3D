// Capacités du calcul en lot (`mathBatchState.ts`) : quand le module WebAssembly n'est pas jouable,
// le chemin JavaScript est annoncé avec une raison — jamais un repli silencieux. Node ne sait pas
// suivre une URL de fichier avec `fetch` (`geometryPageWasm.ts::ressource`) : sans octets fournis à
// la main, `prepareMathBatch` retombe donc naturellement sur ce cas, sans aucune simulation.
import test from 'node:test';
import assert from 'node:assert/strict';

test('sans module chargé, les capacités annoncent le chemin JavaScript et pourquoi', async () => {
  const { prepareMathBatch, mathBatchMetrics } = await import('./mathBatchState.ts');
  await prepareMathBatch('auto');
  const etat = mathBatchMetrics();
  assert.equal(etat.wasmAvailable, false);
  assert.equal(etat.wasmSimd, null);
  assert.notEqual(etat.unavailableReason, null, 'la raison ne doit jamais être silencieuse');
  assert.equal(typeof etat.unavailableReason, 'string');
});
