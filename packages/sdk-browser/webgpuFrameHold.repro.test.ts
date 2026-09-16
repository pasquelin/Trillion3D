// Reproduction GEO-02 (WebGPU) : image tenue masquant la compilation asynchrone du programme
// d'éclairage différé. Doit être inversé après correction — voir orchestration pour le rapport.
//
// `frameSettled` (webgpuFrameHold.ts) ne regarde ni `gpu.deferred.usesContract`, ni les compilations
// de programme en cours, ni `rt.sunFar.pending`. Ce fichier construit un `rt` minimal, à la main,
// qui satisfait exactement les conditions lues par `frameSettled`/`holdWebgpuFrame`, et exerce le
// VRAI module `deferredLighting.ts` (via un faux `GPUDevice` dont `createRenderPipelineAsync` ne
// résout la variante DIRECT/BOUNCE que sur commande) pour prouver que l'image tenue continue de
// présenter le programme `unlit` longtemps après que le programme du contrat a fini de compiler.
//
// Harnais réduit assumé : reproduire les points 1-4 de la reprise via le backend WebGPU complet
// (`webgpuPagesBackend` + sélection de pages GPU + Hi-Z + visibilité) s'est avéré hors de portée
// raisonnable pour un test de reproduction — aucun test existant du dépôt ne pousse `holdWebgpuFrame`
// jusqu'à `true` par ce chemin (recherché, absent). Le harnais ci-dessous pilote directement les
// briques réelles (`holdWebgpuFrame`, `keepWebgpuFrame`, `createFrameHold`, `bumpScene`,
// `createDeferredLighting`) avec un `rt` à la main plutôt que de rejouer tout `renderWebgpuPages`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './webgpuFrameHold.ts';
import { createFrameHold, createFrameRevisions, bumpScene } from './frameRevisions.ts';
import { HOLD_SIGNATURE_VALUES } from './webgpuFrameSignature.ts';
import { createDeferredLighting } from './deferredLighting.ts';
import { createSceneLightStore } from '../sdk-core/index.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

Object.assign(globalThis, {
  GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 },
  GPUShaderStage: { FRAGMENT: 2 },
  GPUTextureUsage: { TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 },
});

/**
 * Faux GPUDevice dont `createRenderPipelineAsync` distingue la variante par le nom du module (posé
 * par `createCheckedShaderModule` via `${label}_LIGHTING` / `${label}_COMPOSE`) : UNLIT résout tout
 * de suite (sinon `createDeferredLighting` ne se termine jamais), DIRECT et BOUNCE restent en
 * attente tant que `finishCompilation()` n'a pas été appelé, exactement comme
 * `device.createRenderPipelineAsync` le ferait pendant une vraie compilation de plusieurs images.
 */
function deferredLightingHarness() {
  let resolveGate: () => void;
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  const device = {
    createBuffer: () => ({ destroy() {} }),
    createShaderModule: (desc: { label?: string }) => ({
      label: desc.label,
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createBindGroupLayout: () => ({}),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createSampler: () => ({}),
    createPipelineLayout: () => ({}),
    async createRenderPipelineAsync(descriptor: {
      fragment?: { module?: { label?: string } };
    }) {
      const label = descriptor.fragment?.module?.label ?? '';
      if (label.startsWith('DIRECT') || label.startsWith('BOUNCE')) await gate;
      return {};
    },
    createBindGroup: () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
  return { device, finishCompilation: () => resolveGate() };
}

const view = () => ({}) as GPUTextureView;
const surface = { views: () => [view(), view(), view(), view()] } as unknown as Parameters<
  Awaited<ReturnType<typeof createDeferredLighting>>['bind']
>[0];

/**
 * Un `rt` réduit au strict nécessaire lu par `frameSettled`/`holdWebgpuFrame`/`keepWebgpuFrame` :
 * toutes les conditions de `frameSettled` y sont vraies par construction, comme demandé pour le test
 * réduit de repli. `gpu.presenter`/`gpu.colorTexture` restent absents pour que `holdWebgpuFrame` ne
 * tente pas d'encoder une vraie commande de présentation.
 */
function settledRt(lightStore = createSceneLightStore()) {
  const revisions = createFrameRevisions();
  const run = {
    frameHold: createFrameHold(HOLD_SIGNATURE_VALUES),
    revisions,
    lost: false,
    gpuFrameActive: true,
    gpuMetricsReady: true,
    cutHeld: true,
    overBudget: false,
    coverageBudgetLimited: false,
    uncoveredTriangles: 0,
    noOccluderHistory: false,
    deferredDrops: new Set<string>(),
    desired: [] as { array?: Uint32Array }[],
    frame: 0,
    frameHeld: false,
    imageRevision: 0,
    // Champs lus par `sampleWebgpuFrame` (signature de l'image tenue) : constants d'une image à
    // l'autre pour que `keep()` juge deux images consécutives identiques.
    cutEpoch: 1,
    pageArrayEpoch: 1,
    visible: 1,
    selectedTriangles: 3,
    submittedTriangles: 3,
    drawnTriangles: 3,
    frustumRejected: 0,
    lodLevel: 0,
    gpuDrawCalls: 2,
    blendDrawCalls: 0,
    blendSubmittedTriangles: 0,
    blendFrustumRejected: 0,
    occluderSignature: 0,
    budgetPixelError: 0,
  };
  const rows = {
    rowsChanged: false,
    dirtyTo: -1,
    dirtyFrom: 0,
    rowsEpoch: 1,
    tableEpoch: 1,
    candidateOverflow: false,
    packedCount: 1,
    rowCount: 1,
  };
  const rt = {
    run,
    layout: { rows },
    vis: { visEnabled: true, gpuDraw: true, textureJobs: [] as unknown[], gpuHiz: undefined },
    lights: {
      store: lightStore,
      plan: { counts: { pendingPages: 0 } },
      shadowsUpdated: 0,
      shadowFaces: 0,
    },
    bounce: { probes: undefined as unknown },
    capture: { secondaryCamera: false, capturePending: false },
    services: { bootstrapState: { ready: true }, residency: { busy: false } },
    timing: { frameEncoder: undefined as unknown, partitionCounts: { occulteurs: 0, testees: 0 } },
    texturePump: { inFlight: false },
    gpu: {
      presenter: undefined as unknown,
      colorTexture: undefined as unknown,
      canvasTexture: undefined as unknown,
      deferred: undefined as Awaited<ReturnType<typeof createDeferredLighting>> | undefined,
    },
    sunFar: { pending: undefined as Promise<unknown> | undefined, gpu: undefined as unknown },
  };
  return rt as unknown as WebgpuPagesRuntime & typeof rt;
}

test('GEO-02 repro : image tenue masque un programme du contrat encore en compilation (défaut)', async () => {
  const h = deferredLightingHarness();
  const lightStore = createSceneLightStore();
  lightStore.add({
    id: 'point-1',
    kind: 'point',
    position: [2, 2, 2],
    color: [1, 1, 1],
    intensity: 5,
    range: 20,
    castsShadow: false,
  });
  const lighting = await createDeferredLighting(h.device, {} as GPUBuffer);
  const rt = settledRt(lightStore);
  rt.gpu.deferred = lighting;
  const fakeDevice = h.device;

  // --- Image 1 (réelle) : première demande du contrat, compilation DIRECT lancée, unlit en attendant.
  lighting.bind(surface, view(), view(), true, {}, () => {});
  rt.run.frame++;
  keepWebgpuFrame(rt);
  assert.equal(lighting.usesContract, false, 'la compilation démarre, le rendu reste unlit');
  assert.equal(rt.run.frameHold.stable, false, 'une seule image gardée ne peut pas être stable');

  // --- Image 2 (réelle, rien n'a bougé) : deuxième image identique -> le témoin devient stable.
  assert.equal(holdWebgpuFrame(rt, fakeDevice), false, 'pas encore stable : rendu refait');
  lighting.bind(surface, view(), view(), true, {}, () => {});
  rt.run.frame++;
  keepWebgpuFrame(rt);
  assert.equal(rt.run.frameHold.stable, true, 'deux images identiques de suite arment la tenue');

  const frameAfterTwoReal = rt.run.frame;
  assert.equal(frameAfterTwoReal, 2);

  // --- Images 3 et 4 : tenues. Aucune étape processeur, donc `bind()` n'est jamais rappelé.
  for (let i = 0; i < 2; i++) {
    const held = holdWebgpuFrame(rt, fakeDevice);
    assert.equal(held, true, 'frameSettled ne lit ni usesContract ni compilations en cours');
  }
  assert.equal(rt.run.frameHeld, true);
  assert.equal(rt.run.frame, frameAfterTwoReal, "l'image tenue n'incrémente jamais run.frame");
  assert.equal(
    lighting.usesContract,
    false,
    'DÉFAUT : le programme unlit reste actif alors que la lampe est déclarée',
  );

  // --- La compilation DIRECT se termine pendant que l'image est tenue.
  h.finishCompilation();
  await lighting.settle();

  // --- Deux images tenues de plus : le défaut persiste malgré la compilation terminée.
  for (let i = 0; i < 2; i++) assert.equal(holdWebgpuFrame(rt, fakeDevice), true);
  assert.equal(rt.run.frame, frameAfterTwoReal, 'run.frame toujours inchangé (défaut)');
  assert.equal(
    lighting.usesContract,
    false,
    'DÉFAUT confirmé : programme prêt, mais usesContract reste faux tant que bind() n’est pas rappelé',
  );

  // --- Invalidation manuelle (ex. bumpScene / setLight) : l'image suivante refait le travail.
  bumpScene(rt.run.revisions);
  assert.equal(
    holdWebgpuFrame(rt, fakeDevice),
    false,
    'une révision de scène change casse la tenue',
  );
  assert.equal(rt.run.frameHeld, false);
  // Rendu réel simulé : bind() est rappelé, et seulement maintenant le contrat prend effet.
  lighting.bind(surface, view(), view(), true, {}, () => {});
  assert.equal(
    lighting.usesContract,
    true,
    'usesContract ne passe à vrai qu’au premier bind() qui suit une invalidation',
  );
});

test('GEO-02 repro (repli minimal) : holdWebgpuFrame retourne true avec gpu.deferred.usesContract figé et une lampe déclarée', () => {
  const lightStore = createSceneLightStore();
  lightStore.add({
    id: 'point-1',
    kind: 'point',
    position: [0, 0, 0],
    color: [1, 1, 1],
    intensity: 3,
    range: 10,
    castsShadow: false,
  });
  const rt = settledRt(lightStore);
  // Repli explicitement autorisé par la consigne : `gpu.deferred` réduit à `usesContract`.
  rt.gpu.deferred = { usesContract: false } as unknown as Awaited<
    ReturnType<typeof createDeferredLighting>
  >;
  // Ombre lointaine encore en vol : `sunFar.pending` ne résout jamais dans ce test.
  rt.sunFar.pending = new Promise(() => {});
  const fakeDevice = {} as GPUDevice;
  keepWebgpuFrame(rt);
  keepWebgpuFrame(rt);
  assert.equal(rt.run.frameHold.stable, true);
  assert.equal(
    holdWebgpuFrame(rt, fakeDevice),
    true,
    'DÉFAUT : frameSettled ignore gpu.deferred.usesContract et rt.sunFar.pending',
  );
  assert.equal(rt.run.frameHeld, true);
});
