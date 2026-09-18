import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { camera, quadBackend } from './webgpuPagesTestScenes.ts';
import { setWebgpuMemoryBudgets } from './webgpuPagesMemory.ts';
import { geometryPoolFor } from './webgpuMemoryBudgets.ts';

// Le moteur change de réservoirs en cours de session — ce qu'un curseur d'une application appelle —
// sans se préparer de nouveau et sans perdre l'image : le rapport dit ce qu'il tient vraiment.
test('setMemoryBudgets règle les réservoirs en session, les ramène nommément, et l’image continue', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  // Deux pages racines de 12 octets : un budget d'une page est relevé à la couverture racine.
  const { fixture, backend } = quadBackend(device, {
    maxResidentPages: undefined,
    geometryPoolBytes: 12,
  });
  try {
    await backend.prepare();
    backend.render(camera());
    const before = backend.metrics();
    assert.deepEqual(
      [before.geometryPoolBytes, before.geometryPoolSlots, before.geometryPoolClamp],
      [12, 2, 'root-cover'],
    );
    // Plus que la scène n'a de pages : ramené à la scène, nommément, rien n'est évincé.
    const grown = await backend.setMemoryBudgets!({ geometryPoolBytes: 1024 * 1024 * 1024 });
    assert.deepEqual([grown.geometryPool.clamp, grown.geometryPool.slots], ['scene', 2]);
    assert.equal(grown.evictedPages, 0);
    // Sous la couverture racine : relevé jusqu'à elle, nommément ; les racines ne partent jamais.
    const shrunk = await backend.setMemoryBudgets!({ geometryPoolBytes: 1, texturePoolBytes: 1 });
    assert.equal(shrunk.geometryPool.clamp, 'root-cover');
    assert.equal(shrunk.texturePool.clamp, 'minimum');
    assert.equal(shrunk.texturePool.layers, 1);
    assert.ok(shrunk.durationMs >= 0);
    backend.render(camera());
    const after = backend.metrics();
    assert.equal(after.geometryPoolSlots, shrunk.geometryPool.slots);
    assert.equal(after.geometryPoolClamp, 'root-cover');
    assert.equal(after.coverageReady, true);
    assert.equal(after.texturePoolClamp, 'minimum');
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('un réglage au-dessus du plafond de la session est ramené au plafond, et le cache redimensionné une fois', async () => {
  const resized: number[] = [],
    unpinned: number[] = [];
  let resources = 0;
  const setup = {
    cap: 4,
    geometryPool: { slots: 2 },
    texturePool: { layers: 1 },
    gpuDevice: { limits: {} },
    geometryPoolFor: (budgetBytes: number) =>
      geometryPoolFor({
        budgetBytes,
        pageBytes: 8,
        uniquePages: 100,
        rootPages: 1,
        ceilingSlots: 4,
      }),
    tracking: {
      pageCatalogIds: new Map([['p', 7]]),
      unmarkPinned: (k: number) => unpinned.push(k),
    },
    get slots() {
      return this.geometryPool.slots;
    },
  };
  const rt = {
    setup,
    gpu: {
      cache: {
        resize: async (n: number) => (resized.push(n), ['p']),
        stats: () => ({ residentPages: 3 }),
      },
      bindGroups: new Map(),
    },
    vis: { visSlotGroups: [], rasterGroups: [] },
    blendState: { blendGpu: [] },
    run: { lost: false, gate: { resourcesChanged: () => resources++ } },
    diag: { engineDiagnostic() {} },
  };
  const report = await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 800 });
  assert.deepEqual([report.geometryPool.clamp, report.geometryPool.slots], ['ceiling', 4]);
  assert.deepEqual(resized, [4]);
  assert.deepEqual(unpinned, [7], 'la page évincée est désépinglée côté trace');
  assert.equal(report.evictedPages, 1);
  assert.deepEqual(report.residentPages, { before: 3, after: 3 });
  assert.equal(setup.slots, 4);
  assert.equal(resources, 1);
  // La même valeur de nouveau : rien à redimensionner.
  await setWebgpuMemoryBudgets(rt as never, { geometryPoolBytes: 800 });
  assert.deepEqual(resized, [4]);
});
