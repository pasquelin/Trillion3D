// GEO-02, non-régression : l'image tenue ne peut plus masquer l'arrivée d'un programme du contrat.
//
// `holdWebgpuFrame` tient l'image tant que les trois révisions et la signature n'ont pas bougé. La
// compilation du programme d'éclairage différé se termine entre deux images, sans qu'aucune étape ne
// l'écrive : tant que son arrivée n'incrémentait aucune révision, deux images identiques figeaient
// l'albédo brut d'`unlit` jusqu'à une invalidation étrangère. Le rappel `onReady` de
// `createDeferredLighting` répare ça à l'origine du changement, et c'est ce que ce fichier prouve
// avec les vraies briques : `createDeferredLighting`, `resourceArrived`, `holdWebgpuFrame`,
// `keepWebgpuFrame`. Le `rt` est monté à la main, réduit à ce que `frameSettled` lit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './webgpuFrameHold.ts';
import { createFrameHold, createFrameRevisions, resourceArrived } from './frameRevisions.ts';
import { HOLD_SIGNATURE_VALUES } from './webgpuFrameSignature.ts';
import { createDeferredLighting } from './deferredLighting.ts';
import type { DirectLightResources } from './deferredLightingProgram.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

installGpuGlobals();

/**
 * Faux GPUDevice dont `createRenderPipelineAsync` distingue la variante par le nom du module (posé
 * par `createCheckedShaderModule` via `${label}_LIGHTING` / `${label}_COMPOSE`) : UNLIT résout tout
 * de suite, DIRECT et BOUNCE restent en attente tant que `finishCompilation()` n'a pas été appelé,
 * exactement comme une vraie compilation qui dure plusieurs images.
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
    async createRenderPipelineAsync(descriptor: { fragment?: { module?: { label?: string } } }) {
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
 * toutes les conditions de `frameSettled` y sont vraies par construction. `gpu.presenter` et
 * `gpu.colorTexture` restent absents pour que la tenue n'encode aucune commande de présentation.
 */
function settledRt() {
  const run = {
    frameHold: createFrameHold(HOLD_SIGNATURE_VALUES),
    revisions: createFrameRevisions(),
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
    // Champs lus par `sampleWebgpuFrame` : constants d'une image à l'autre pour que `keep()` juge
    // deux images consécutives identiques.
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
    lights: { plan: { counts: { pendingPages: 0 } }, shadowsUpdated: 0, shadowFaces: 0 },
    bounce: { probes: undefined as unknown },
    capture: { secondaryCamera: false, capturePending: false },
    services: { bootstrapState: { ready: true }, residency: { busy: false } },
    timing: { frameEncoder: undefined as unknown, partitionCounts: { occulteurs: 0, testees: 0 } },
    texturePump: { inFlight: false },
    gpu: {
      presenter: undefined as unknown,
      colorTexture: undefined as unknown,
      deferred: undefined as Awaited<ReturnType<typeof createDeferredLighting>> | undefined,
    },
    sunFar: { pending: undefined as Promise<unknown> | undefined, gpu: undefined as unknown },
  };
  return rt as unknown as WebgpuPagesRuntime & typeof rt;
}

test('GEO-02 : le programme du contrat qui finit de compiler casse l’image tenue', async () => {
  const h = deferredLightingHarness();
  const rt = settledRt();
  // Le branchement de `webgpuPagesPrepare.ts`, mot pour mot.
  const lighting = await createDeferredLighting(h.device, {} as GPUBuffer, () =>
    resourceArrived(rt.run),
  );
  rt.gpu.deferred = lighting;

  // Deux images réelles identiques : la compilation DIRECT est lancée, `unlit` rend en attendant.
  for (let i = 0; i < 2; i++) {
    lighting.bind(surface, view(), view(), true, {}, () => {});
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  assert.equal(lighting.usesContract, false, 'la compilation démarre, le rendu reste unlit');
  assert.equal(rt.run.frameHold.stable, true, 'deux images identiques de suite arment la tenue');
  // Tenir pendant la compilation reste juste : rien n'a encore changé l'image.
  assert.equal(holdWebgpuFrame(rt, h.device), true);
  const frameTenue = rt.run.frame;

  // Le programme arrive : le rappel incrémente les ressources et casse la tenue.
  const ressources = rt.run.revisions.resources;
  h.finishCompilation();
  await lighting.settle();
  assert.equal(rt.run.revisions.resources, ressources + 1, 'le programme arrivé est une ressource');
  assert.equal(holdWebgpuFrame(rt, h.device), false, 'l’image suivante est refaite');
  assert.equal(rt.run.frameHeld, false);

  // L'image refaite adopte le programme du contrat : la lampe déclarée éclaire enfin.
  lighting.bind(surface, view(), view(), true, {}, () => {});
  rt.run.frame++;
  keepWebgpuFrame(rt);
  assert.equal(lighting.usesContract, true, 'le contrat rend l’image qui suit son arrivée');
  assert.equal(rt.run.frame, frameTenue + 1);
});

test('GEO-02 : les deux variantes du contrat annoncent leur arrivée, DIRECT comme BOUNCE', async () => {
  const h = deferredLightingHarness();
  let arrivees = 0;
  const lighting = await createDeferredLighting(h.device, {} as GPUBuffer, () => arrivees++);
  const rebond = { bounceGrid: {}, probes: {} } as unknown as DirectLightResources;
  lighting.bind(surface, view(), view(), true, {}, () => {});
  lighting.bind(surface, view(), view(), true, rebond, () => {});
  assert.equal(arrivees, 0, 'rien n’est annoncé tant que les deux compilations durent');
  h.finishCompilation();
  await lighting.settle();
  assert.equal(arrivees, 2, 'DIRECT et BOUNCE annoncent chacun le leur');
});
