import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** An engine reduced to its targets, with a dummy temporal pass that notes its resizes. */
export function runtime() {
  const resized: number[][] = [],
    failures: string[] = []
  const temporal = {
    frame: { hasHistory: true, stillFrames: 5 },
    resize(w: number, h: number) {
      resized.push([w, h])
      return true
    },
    release() {},
    dispose() {},
  }
  const rt = {
    setup: {},
    // A textured scene's: its pipelines write the feedback (`feedbackVariant.ts`).
    vis: { gpuHiz: {}, writesFeedback: true, writesEmissiveAo: true },
    run: { diagnostic: 'beauty' },
    layout: { rows: { packedCount: 0, packedRecs: [] } },
    blendState: { blendGpu: [] },
    context: {},
    gpu: { device: fakeDevice({ limits: { maxTextureDimension2D: 8192 } }).device, temporal },
    capture: { capturing: false },
    capabilities: { unsupported: [] as string[] },
    diag: { diagnosticFailure: (phase: string) => failures.push(phase) },
  } as unknown as WebgpuPagesRuntime
  return { rt, temporal, resized, failures }
}
