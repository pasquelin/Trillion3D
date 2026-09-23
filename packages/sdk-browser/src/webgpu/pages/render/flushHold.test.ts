// Flush no longer drops the held-image witness by default: a host that flushes every image — the
// measurement harness — would otherwise never hold an image, even when nothing the image
// depends on has moved. Only a drain that actually changes the image drops it, by incrementing the
// revision that names what it changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameGateCore } from '../../../frame/gateCore.ts';
import { HOLD_SIGNATURE_VALUES } from '../../frame/signature.ts';
import { flushWebgpuPages } from './flush.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** A minimal flush state: no GPU, no texture, no in-flight residency. */
function vidange(adopte?: () => boolean, arme = true) {
  const gate = createFrameGateCore(HOLD_SIGNATURE_VALUES);
  const { hold: frameHold, revisions } = gate;
  // Two identical consecutive images: the witness is armed and stable, as after two renders.
  if (arme) {
    frameHold.keep(revisions);
    frameHold.keep(revisions);
  }
  const run = {
    gate,
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
    capture: { capturing: false, capturePending: undefined },
    timing: { gpuTiming: undefined },
    diag: { engineDiagnostic: () => {}, diagnosticFailure: () => {} },
    services: {
      bootstrapState: { ready: true, ensure: async () => {} },
      residency: { pending: Promise.resolve() },
      adoptGpuCut: adopte ?? (() => false),
    },
    setup: { gpuDevice: undefined, bootstrap: [] },
    context: { gpuCanvas: undefined },
    blendState: { blendGpu: [], visibleBlend: [] },
    lights: { plan: { counts: { pendingPages: 0 } } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, gate, frameHold, revisions };
}

test('a flush that drains nothing leaves the held-image witness standing', async () => {
  const { rt, gate, revisions } = vidange();
  assert.equal(gate.held(), true, 'the witness starts armed');
  await flushWebgpuPages(rt);
  await flushWebgpuPages(rt);
  assert.equal(gate.held(), true, 'the flush dropped the witness without having drained anything');
  assert.equal(gate.hold.same(revisions), true, 'the revisions have not moved');
});

test('a flush whose adoption changes the cut drops the witness', async () => {
  const { rt, gate } = vidange(() => true);
  await flushWebgpuPages(rt);
  assert.equal(gate.held(), false, 'the cut changed under the held image');
});

test('a flush whose adoption changes nothing leaves the witness standing', async () => {
  const { rt, gate } = vidange(() => false);
  await flushWebgpuPages(rt);
  assert.equal(gate.held(), true, 'no list rewritten, no reason to redo the image');
});

test('three images and three flushes with no write: the third is held', async () => {
  // What a host that flushes per image does — the harness: render, flush, repeat. The GPU
  // returns one sample per image, identical at a still pose, so adoption rewrites nothing.
  let adoptions = 0;
  const { rt, gate, frameHold, revisions } = vidange(() => (adoptions++, false), false);
  let tenues = 0;
  for (let image = 0; image < 3; image++) {
    // A complete image: it is stored with the signature of what it produced.
    if (gate.held()) tenues++;
    else frameHold.keep(revisions);
    await flushWebgpuPages(rt);
  }
  assert.equal(adoptions, 3, 'the flush does replay one adoption per image');
  assert.equal(tenues, 1, 'the third image must be held');
  assert.equal(gate.held(), true, 'the witness survived the three flushes');
});
