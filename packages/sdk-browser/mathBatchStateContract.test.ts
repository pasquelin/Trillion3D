// Second scénario des capacités du calcul en lot : un module qui s'instancie mais dont le contrat de
// calcul n'est pas celui attendu. Séparé de `mathBatchState.test.ts` parce que `prepareSdkWasm`
// mémorise sa décision pour tout le process — un seul scénario de chargement par fichier, comme
// `geometryPageWasm.test.ts` le fait déjà pour le décodeur.
import test from 'node:test';
import assert from 'node:assert/strict';

test('un contrat de calcul inconnu laisse tout sur JavaScript, avec la raison publiée', async () => {
  const instantiateOriginal = WebAssembly.instantiate;
  const fetchOriginal = globalThis.fetch;
  // `ressource()` (`geometryPageWasm.ts`) tire ses octets par `fetch` : sans réponse simulée, l'appel
  // échoue avant même d'atteindre `WebAssembly.instantiate`, comme le montre `mathBatchState.test.ts`.
  // @ts-expect-error : réponse minimale, suffisante pour passer `reponse.ok` puis `arrayBuffer()`.
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  // @ts-expect-error : simule un module dont l'ABI de calcul a changé de version.
  WebAssembly.instantiate = async () => ({
    instance: {
      exports: {
        math_contract: () => 2, // le chargeur attend WASM_ARENA_CONTRACT (1)
        math_simd: () => 1,
      },
    },
  });
  try {
    const { prepareMathBatch, mathBatchMetrics } = await import('./mathBatchState.ts');
    await prepareMathBatch('auto');
    const etat = mathBatchMetrics();
    assert.equal(etat.wasmAvailable, false);
    assert.equal(etat.wasmSimd, null);
    assert.match(etat.unavailableReason ?? '', /contrat de calcul/);
  } finally {
    WebAssembly.instantiate = instantiateOriginal;
    globalThis.fetch = fetchOriginal;
  }
});
