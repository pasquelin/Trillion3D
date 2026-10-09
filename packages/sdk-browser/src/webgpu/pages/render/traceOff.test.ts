// With tracing off, no per-image trace site reaches `traceDiagnostic`: neither its lazy closure nor
// an eager payload is built. With tracing on, each site still emits its record, once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { traceGpuCutFrame, traceGpuCutWaiting } from './gpuCutTrace.ts'
import { submitColorCopy } from './encoder.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The runtime slice the trace sites read, counting the records they emit. */
function runtime(traceEnabled: boolean) {
  const phases: string[] = []
  const rt = {
    diag: {
      traceEnabled,
      traceDiagnostic: (phase: string, _message: string, details: unknown) => {
        phases.push(phase)
        if (typeof details === 'function') details()
      },
    },
    run: { frame: 1, imageRevision: 0, desired: [], drawn: [], shown: [], gpuDrawCalls: 0 },
    setup: {
      tracking: { traceSet: () => ({}), traceRecs: () => ({}) },
      bootstrap: [],
      bootstrapKey: new Uint8Array(64),
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
    lights: {},
    gate: {},
  } as unknown as WebgpuPagesRuntime
  return { rt, phases }
}

const cam = { world: new Float32Array(16), eye: [0, 0, 0] } as never
const device = { queue: { submit: () => {} } } as unknown as GPUDevice
const encoder = { finish: () => ({}) } as unknown as GPUCommandEncoder

/** Every per-image trace site, in the order the GPU cut reaches them. */
function traceEverySite(rt: WebgpuPagesRuntime) {
  traceGpuCutWaiting(rt)
  submitColorCopy(rt, device, encoder, 1, 1)
}

test('tracing off: no trace site calls traceDiagnostic', () => {
  const { rt, phases } = runtime(false)
  traceEverySite(rt)
  traceGpuCutFrame(rt, cam)
  assert.deepEqual(phases, [])
})

test('tracing on: every guarded site still emits its record once', () => {
  const { rt, phases } = runtime(true)
  traceEverySite(rt)
  assert.deepEqual(phases, ['frame', 'encoding-submit'])
})
