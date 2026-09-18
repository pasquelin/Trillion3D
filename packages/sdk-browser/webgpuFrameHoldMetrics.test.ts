// Une image tenue réaffiche la cible de l'image précédente. Elle publiait encore les compteurs de
// dessin et les durées d'étape du dernier rendu complet, c'est-à-dire un travail qu'elle n'avait pas
// fait. Elle publie désormais la présentation seule, et laisse intactes les métriques de la coupe
// qu'elle réaffiche.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameGateCore } from './frameGateCore.ts';
import { HOLD_SIGNATURE_VALUES } from './webgpuFrameSignature.ts';
import { CPU_STEP, CPU_STEP_NAMES } from './webgpuPagesCpuSteps.ts';
import { holdWebgpuFrame } from './webgpuFrameHold.ts';
import { metricsOf } from './webgpuPagesMetrics.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un moteur dont toutes les conditions de `frameSettled` sont vraies et dont la dernière image
 *  complète a dessiné beaucoup : c'est elle que la tenue ne doit pas republier. */
function tenue() {
  const gate = createFrameGateCore(HOLD_SIGNATURE_VALUES);
  gate.hold.keep(gate.revisions);
  gate.hold.keep(gate.revisions);
  const run = {
    gate,
    frameHeld: false,
    frame: 5,
    lost: false,
    desired: [],
    drawn: [],
    gpuFrameActive: true,
    gpuMetricsReady: true,
    cutHeld: true,
    overBudget: false,
    coverageBudgetLimited: false,
    uncoveredTriangles: 0,
    noOccluderHistory: false,
    deferredDrops: new Set(),
    imageRevision: 3,
    gpuDrawCalls: 42,
    blendDrawCalls: 7,
    submittedTriangles: 123456,
    blendSubmittedTriangles: 99,
    cpuSelectMs: 3.5,
    // Ce que l'image MONTRE : la coupe, qui ne bouge pas.
    visible: 800,
    selectedTriangles: 123456,
    frustumRejected: 29987,
    lodLevel: 2,
    blendFrustumRejected: 11,
    cpuHizCounted: false,
  };
  const timing = {
    frameEncoder: undefined,
    lastGpuPassMs: { frame: 4, totalMs: 9, passes: [], truncated: false },
    lastGpuFrameMs: 9,
    lastGpuHostGapMs: 2,
    lastSubmitMs: 8,
    cpuProfile: { row: new Float64Array(CPU_STEP_NAMES.length).fill(7) },
    rowFilled: false,
    cpuSample: { version: 1 },
    partitionCounts: {},
  };
  const rt = {
    run,
    timing,
    gpu: {
      presenter: { present: () => {} },
      colorTexture: {},
      targetSize: [4, 4],
      canvasTexture: undefined,
      cache: undefined,
      vertexBytes: 0,
      positionBuffers: new Map(),
    },
    vis: { visEnabled: true, gpuDraw: {}, textureJobs: [], gpuHiz: undefined },
    capture: { secondaryCamera: undefined, capturePending: undefined },
    services: {
      bootstrapState: { ready: true },
      residency: { busy: false },
      // Le compte des pages de la coupe qui attendent encore leurs octets, tenu par la différence.
      cutPending: { count: 0 },
    },
    layout: {
      rows: {
        rowsChanged: false,
        dirtyFrom: 1,
        dirtyTo: -1,
        rowsEpoch: 1,
        tableEpoch: 1,
        candidateOverflow: false,
      },
    },
    lights: { plan: { counts: { pendingPages: 0, waitedMs: 0 } } },
    bounce: { probes: undefined },
    blendState: { visibleBlend: [] },
  } as unknown as WebgpuPagesRuntime;
  const device = {
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { submit: () => {} },
  } as unknown as GPUDevice;
  return { rt, run, timing, device };
}

test('une image tenue ne compte que sa présentation, pas le dernier rendu complet', () => {
  const { rt, run, timing, device } = tenue();
  assert.equal(holdWebgpuFrame(rt, device), true, 'l’image aurait dû être tenue');
  assert.equal(run.frameHeld, true);
  assert.equal(run.gpuDrawCalls, 1, 'la présentation est le seul appel de dessin');
  assert.equal(run.blendDrawCalls, 0);
  assert.equal(run.submittedTriangles, 0, 'aucun triangle n’a été soumis');
  assert.equal(run.blendSubmittedTriangles, 0);
  assert.equal(run.cpuSelectMs, null, 'aucune coupe processeur n’a tourné');
  assert.equal(timing.lastGpuPassMs, null, 'aucune passe n’a été chronométrée');
  assert.equal(timing.lastGpuFrameMs, null);
  assert.equal(timing.lastGpuHostGapMs, null);
});

test('les durées d’étape d’une image tenue ne décrivent que la présentation', () => {
  const { rt, timing, device } = tenue();
  holdWebgpuFrame(rt, device);
  const row = timing.cpuProfile.row;
  const presentation = new Set([
    CPU_STEP.queueSubmitMs,
    CPU_STEP.encodeSubmitMs,
    CPU_STEP.submitMs,
    CPU_STEP.totalMs,
  ]);
  for (let i = 0; i < row.length; i++)
    if (!presentation.has(i)) assert.equal(row[i], 0, `étape ${CPU_STEP_NAMES[i]} non exécutée`);
  assert.equal(timing.rowFilled, true, 'la ligne de l’image tenue est déposée');
  assert.equal(timing.cpuSample, undefined, 'le relevé détaillé d’une autre image est retiré');
});

test('les métriques de la coupe réaffichée ne bougent pas', () => {
  const { rt, run, device } = tenue();
  holdWebgpuFrame(rt, device);
  const metrics = metricsOf(rt);
  assert.equal(metrics.frameHeld, true);
  assert.equal(metrics.clusters, 800, 'la coupe réaffichée est la même');
  assert.equal(metrics.selectedTriangles, 123456);
  assert.equal(metrics.frustumRejected, 29987);
  assert.equal(metrics.lodLevel, 2);
  assert.equal(metrics.drawCalls, 1);
  assert.equal(metrics.submittedTriangles, 0);
  assert.equal(run.frame, 6, 'une image a bien été produite');
});

test('une page de la coupe qui attend ses octets interdit de tenir l’image', () => {
  const { rt, device } = tenue();
  const pending = rt.services.cutPending as { count: number };
  assert.equal(holdWebgpuFrame(rt, device), true, 'une coupe entièrement arrivée se tient');
  // Le compte est celui que la différence de la coupe tient : aucune liste n'est relue ici.
  pending.count = 1;
  assert.equal(holdWebgpuFrame(rt, device), false, 'une page attendue peut encore ouvrir un trou');
  assert.equal(rt.run.frameHeld, false);
  pending.count = 0;
  assert.equal(holdWebgpuFrame(rt, device), true);
});
