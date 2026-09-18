// Lot « compteurs honnêtes du harnais de mesure » : le relevé de `measureView` gardait autrefois
// seulement les mesures `number`/`boolean` du dernier `explorer.render()` — un compteur absent
// (`null`) disparaissait du relevé, indistinguable pour un lecteur d'un compteur jamais posé à la
// question. Il conserve désormais `null` explicitement, et continue de filtrer ce qui n'est ni un
// nombre, ni un booléen, ni `null` (objets, tableaux, `undefined`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureView } from './pageEclairage.mjs';

/** Le faux SDK que `measureView` importe par URL : un `createExplorer` qui rend la doublure posée
 *  sur `globalThis` avant l'appel, comme Playwright sérialise `measureView` dans la vraie page. */
const FAKE_SDK_URL =
  'data:text/javascript,' +
  encodeURIComponent(
    `export const creerMoteur = () => {};
     export async function createExplorer() { return globalThis.__wgTestExplorer; }`,
  );

function canvasMock() {
  return { width: 8, height: 8, addEventListener: () => {}, remove: () => {} };
}

/** Doublure d'explorateur : une seule image rendue, `render()` répond le relevé qu'on lui donne. */
function explorerMock(metrics) {
  return {
    backends: [{ id: 'moteur-test', scene: { children: [] } }],
    setDiagnostic: () => {},
    setPose: () => {},
    render: () => metrics,
    flush: async () => {},
    capture: () => new Uint8Array(4),
    dispose: () => {},
  };
}

async function mesurer(metrics) {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  globalThis.document = { createElement: () => canvasMock(), body: { append: () => {} } };
  globalThis.fetch = async () => ({ status: 200 });
  globalThis.__wgTestExplorer = explorerMock(metrics);
  try {
    return await measureView({
      sdkUrl: FAKE_SDK_URL,
      modulesUrl: './',
      backend: 'creerMoteur',
      engineId: 'moteur-test',
      width: 8,
      height: 8,
      pixelError: 1,
      maxPages: 4,
      warmup: 0,
      frames: 1,
      pose: { position: [0, 0, 0] },
      captureFile: 'test.png',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    delete globalThis.__wgTestExplorer;
  }
}

test('measureView garde un `null` explicite dans le relevé, au lieu de l’effacer', async () => {
  const { metrics } = await mesurer({ triangles: null, gpuSelectionFallback: null, drawCalls: 3 });
  assert.equal(metrics.triangles, null, '`null` doit rester, pas disparaître du relevé');
  assert.equal(metrics.gpuSelectionFallback, null);
  assert.equal(metrics.drawCalls, 3, 'un nombre mesuré passe toujours');
  assert.ok(
    'triangles' in metrics,
    'la clé elle-même doit être présente, pas seulement `undefined`',
  );
});

test('measureView garde un `false` explicite, distinct d’un compteur absent', async () => {
  const { metrics } = await mesurer({ frameHeld: false, imageTenue: true });
  assert.equal(metrics.frameHeld, false);
  assert.equal(metrics.imageTenue, true);
});

test('measureView garde une table de nombres — octets par étiquette — et filtre le reste', async () => {
  const { metrics } = await mesurer({
    triangles: 500,
    gpuAllocatedByLabel: { 'WG display color': 4, 'sans étiquette': 8 },
    scene: { nested: { deep: 1 } },
    pending: [1, 'deux'],
    absent: undefined,
  });
  assert.equal(metrics.triangles, 500);
  assert.deepEqual(metrics.gpuAllocatedByLabel, { 'WG display color': 4, 'sans étiquette': 8 });
  assert.equal(
    'scene' in metrics,
    false,
    'un objet dont une valeur n’est pas un nombre ne passe pas',
  );
  assert.equal('pending' in metrics, false, 'un tableau non plus');
  assert.equal('absent' in metrics, false, '`undefined` reste une absence, pas une valeur publiée');
});
