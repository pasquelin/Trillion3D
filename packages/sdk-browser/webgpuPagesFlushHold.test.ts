// La vidange ne retire plus le témoin d'image tenue d'office : un hôte qui vide à chaque image —
// le harnais de mesure, le Lab — n'aurait sinon jamais d'image tenue, alors que rien de ce dont
// l'image dépend n'a bougé. Seul un drainage qui change réellement l'image le retire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameHold, createFrameRevisions } from './frameRevisions.ts';
import { HOLD_SIGNATURE_VALUES } from './webgpuFrameSignature.ts';
import { flushWebgpuPages } from './webgpuPagesFlush.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un état de vidange minimal : aucune carte, aucune texture, aucune résidence en vol. */
function vidange(adopte?: () => boolean) {
  const revisions = createFrameRevisions();
  const frameHold = createFrameHold(HOLD_SIGNATURE_VALUES);
  // Deux images consécutives identiques : le témoin est armé et stable, comme après deux rendus.
  frameHold.keep(revisions);
  frameHold.keep(revisions);
  const run = {
    revisions,
    frameHold,
    lost: false,
    frame: 1,
    lastProgressMs: performance.now(),
    coverageBudgetLimited: false,
    coverageBudgetEvent: undefined,
    shown: [],
    drawn: [],
    desired: [],
    pendingScratch: [],
    selectedTriangles: 0,
    submittedTriangles: 0,
    blendFrustumRejected: 0,
    blendDrawCalls: 0,
    blendSubmittedTriangles: 0,
    imageRevision: 0,
    gpuFrameActive: !!adopte,
    gpuSelection: adopte ? { flush: async () => {}, failed: () => false } : undefined,
    lastCamera: undefined,
  };
  const rt = {
    run,
    gpu: { surfaces: undefined, deferred: undefined, colorTexture: undefined, targetSize: [8, 8] },
    vis: { textureJobs: [] },
    capture: { secondaryCamera: undefined, capturePending: undefined },
    timing: { gpuTiming: undefined },
    diag: { engineDiagnostic: () => {}, diagnosticFailure: () => {} },
    services: {
      bootstrapState: { ready: true, ensure: async () => {} },
      residency: { pending: Promise.resolve() },
      adoptGpuCut: adopte ?? (() => false),
    },
    setup: { gpuDevice: undefined, bootstrap: [] },
    texturePump: { pump: async () => {}, pending: Promise.resolve() },
    context: { gpuCanvas: undefined },
    blendState: { blendGpu: [], visibleBlend: [] },
    lights: {},
  } as unknown as WebgpuPagesRuntime;
  return { rt, frameHold, revisions };
}

test('une vidange qui ne draine rien laisse le témoin d’image tenue debout', async () => {
  const { rt, frameHold, revisions } = vidange();
  assert.equal(frameHold.stable, true, 'le témoin part armé');
  await flushWebgpuPages(rt);
  await flushWebgpuPages(rt);
  assert.equal(frameHold.stable, true, 'la vidange a retiré le témoin sans rien avoir drainé');
  assert.equal(frameHold.same(revisions), true, 'les révisions n’ont pas bougé');
});

test('une vidange dont l’adoption change la coupe retire le témoin', async () => {
  const { rt, frameHold } = vidange(() => true);
  await flushWebgpuPages(rt);
  assert.equal(frameHold.stable, false, 'la coupe a changé sous l’image tenue');
});

test('une vidange dont l’adoption ne change rien laisse le témoin debout', async () => {
  const { rt, frameHold } = vidange(() => false);
  await flushWebgpuPages(rt);
  assert.equal(frameHold.stable, true, 'aucune liste réécrite, aucune raison de refaire l’image');
});
