// With tracing off, no per-image trace site reaches `traceDiagnostic`: neither its lazy closure nor
// an eager payload is built. With tracing on, each site still emits its record, once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceCpuFrame, traceCpuFrameWaiting, traceCpuSelection } from './trace.ts';
import { traceAdmission, traceDrawnVerify, traceQueueReconstruct } from './steps.ts';
import { traceGpuCutFrame, traceGpuCutWaiting } from './gpuCutTrace.ts';
import { submitColorCopy } from './encoder.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The runtime slice the trace sites read, counting the records they emit. */
function runtime(traceEnabled: boolean) {
  const phases: string[] = [];
  const rt = {
    diag: {
      traceEnabled,
      traceDiagnostic: (phase: string, _message: string, details: unknown) => {
        phases.push(phase);
        if (typeof details === 'function') details();
      },
    },
    run: { frame: 1, imageRevision: 0, desired: [], drawn: [], shown: [], gpuDrawCalls: 0 },
    setup: {
      tracking: { traceSet: () => ({}), traceRecs: () => ({}) },
      bootstrap: [],
      bootstrapUrls: new Set<string>(),
      slots: 4,
    },
    layout: { rows: { packedRecs: [], packedCount: 0, candidateCount: 0 } },
    services: {
      residency: { items: [], job: null },
      bootstrapState: { ready: true },
      poolHolds: () => true,
    },
    timing: {},
    blendState: { blendGpu: [], visibleBlend: [] },
    capture: { capturing: true },
    context: {},
    gpu: {},
    vis: {},
    sunFar: {},
    lights: {},
    gate: {},
  } as unknown as WebgpuPagesRuntime;
  return { rt, phases };
}

const cam = { world: new Float32Array(16), eye: [0, 0, 0] } as never;
const device = { queue: { submit: () => {} } } as unknown as GPUDevice;
const encoder = { finish: () => ({}) } as unknown as GPUCommandEncoder;
const chosen = {
  shown: [],
  visible: 0,
  selectedTriangles: 0,
  frustumRejected: 0,
  lodLevel: 0,
};

/** Every per-image trace site, in the order the CPU and GPU cuts reach them. */
function traceEverySite(rt: WebgpuPagesRuntime) {
  traceCpuSelection(rt, chosen, 0);
  traceCpuFrameWaiting(rt, cam, new Set());
  traceAdmission(rt, new Set(), [], 0);
  traceQueueReconstruct(rt, 0);
  traceDrawnVerify(rt, 0);
  traceGpuCutWaiting(rt);
  submitColorCopy(rt, device, encoder, 1, 1);
}

test('tracing off: no trace site calls traceDiagnostic', () => {
  const { rt, phases } = runtime(false);
  traceEverySite(rt);
  traceCpuFrame(rt, cam);
  traceGpuCutFrame(rt, cam);
  assert.deepEqual(phases, []);
});

test('tracing on: every guarded site still emits its record once', () => {
  const { rt, phases } = runtime(true);
  traceEverySite(rt);
  assert.deepEqual(phases, [
    'cpu-selection',
    'frame',
    'residency-admission',
    'residency-queue-reconstruct',
    'residency-drawn-verify',
    'frame',
    'encoding-submit',
  ]);
});
