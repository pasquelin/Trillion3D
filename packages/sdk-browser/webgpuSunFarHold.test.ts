// GEO-02, deuxième origine : l'ombre lointaine adopte son proxy à la résolution d'une promesse,
// donc entre deux images, sans qu'aucune étape de l'image en cours ne l'écrive. Sans révision, deux
// images identiques figeaient la surface lointaine sans ombre portée alors que le proxy était là.
// `ensureSunFarShadow` incrémente maintenant les ressources et casse la tenue à chaque adoption,
// empruntée comme chargée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSunFarShadow } from './webgpuPagesPrepareSunFar.ts';
import { createFrameGateCore } from './frameGateCore.ts';
import { createWebgpuSunFarState } from './webgpuPagesStateSunFar.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import type { SceneProxy } from '../sdk-core/index.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

installGpuGlobals();

/** Un dispositif factice qui rend ce qu'on lui demande de créer, mappage compris. */
const fakeDevice = () =>
  ({
    createBuffer: ({ size }: { size: number }) => {
      const bytes = new ArrayBuffer(size);
      return { size, getMappedRange: () => bytes, unmap() {}, destroy() {} };
    },
    queue: { writeBuffer() {} },
  }) as unknown as GPUDevice;

/** Le proxy résident tel que le cache le rend : des colonnes vides suffisent à l'adoption. */
const sceneProxy = () =>
  ({
    bounds: [0, 0, 0, 1, 1, 1],
    cellMetres: 0.5,
    errorMetres: 0.1,
    bytes: 0,
    triangles: 0,
    nodes: 0,
    data: {
      triangles: new Float32Array(0),
      albedo: new Uint32Array(0),
      nodeBounds: new Float32Array(0),
      nodeChildren: new Uint32Array(0),
    },
  }) as unknown as SceneProxy;

/** Le `rt` réduit à ce que `ensureSunFarShadow` lit et écrit : l'état, les compteurs et la tenue. */
function sunFarRt(readSceneProxy?: () => Promise<SceneProxy>) {
  const run = { gate: createFrameGateCore(1) };
  // Une image gardée puis une deuxième identique : la tenue est armée et stable, comme avant
  // l'adoption d'un proxy dans une scène qui ne bouge plus.
  run.gate.hold.keep(run.gate.revisions);
  run.gate.hold.keep(run.gate.revisions);
  const rt = {
    run,
    sunFar: createWebgpuSunFarState(),
    bounce: { probes: undefined as unknown, wanted: false, reason: null as string | null },
    context: { readSceneProxy },
    capabilities: { unsupported: [] as string[] },
    diag: { engineDiagnostic() {}, diagnosticFailure() {} },
  };
  return rt as unknown as WebgpuPagesRuntime & typeof rt;
}

/** Ce qu'une adoption doit avoir produit : un proxy gréé, un compteur de plus, une tenue cassée. */
function assertAdoption(rt: ReturnType<typeof sunFarRt>, avant: number) {
  assert.ok(rt.sunFar.gpu?.proxy, 'le proxy est gréé');
  assert.equal(
    rt.run.gate.revisions.resources,
    avant + 1,
    'le proxy adopté est une ressource de plus',
  );
  // `resourcesChanged()` ne touche pas `stable` — un fait historique sur les deux dernières
  // images gardées — mais casse `same()`, donc `held()` : c'est `held()` que `holdWebgpuFrame`
  // consulte pour décider de refaire l'image.
  assert.equal(rt.run.gate.held(), false, 'la tenue est cassée');
  assert.equal(rt.run.gate.hold.same(rt.run.gate.revisions), false, 'les révisions ont bougé');
}

test('GEO-02 : le proxy chargé pour l’ombre lointaine annonce son adoption', async () => {
  const rt = sunFarRt(async () => sceneProxy());
  assert.equal(rt.run.gate.hold.stable, true, 'la tenue est armée avant l’adoption');
  const avant = rt.run.gate.revisions.resources;
  ensureSunFarShadow(rt, fakeDevice());
  await rt.sunFar.pending;
  assertAdoption(rt, avant);
});

test('GEO-02 : le proxy emprunté au rebond annonce lui aussi son adoption', () => {
  const rt = sunFarRt();
  const emprunte = { bounds: [0, 0, 0, 1, 1, 1], cellMetres: 0.5, nodeCount: 1 };
  rt.bounce.probes = { proxy: emprunte } as unknown as WebgpuPagesRuntime['bounce']['probes'];
  const avant = rt.run.gate.revisions.resources;
  ensureSunFarShadow(rt, fakeDevice());
  assert.equal(rt.sunFar.borrowed, true, 'le proxy du rebond est emprunté, jamais rechargé');
  assertAdoption(rt, avant);
});
