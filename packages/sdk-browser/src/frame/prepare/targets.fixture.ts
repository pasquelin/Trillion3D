import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createShapeMemo } from '../../post/taa/historyShape.ts'
import { createFrameRing } from '../../post/taa/historyFrames.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { createResidentSurfaces } from '../../geometry/clusters/surfaces.ts'

/** An engine reduced to its targets, with a dummy temporal pass that notes its resizes. */
export function runtime() {
  const resized: number[][] = [],
    failures: string[] = []
  const device = fakeDevice({ limits: { maxTextureDimension2D: 8192 } }).device
  const temporal = {
    frame: { hasHistory: true, ring: createFrameRing() },
    packed: true,
    wanted: createShapeMemo(device),
    /** Notes the render size the targets are made at. */
    resize(_shape: unknown, w: number, h: number) {
      resized.push([w, h])
      return true
    },
    release() {},
    dispose() {},
  }
  const rt = {
    // A display of one render pixel per CSS pixel (`renderPixelRatio`).
    setup: { pixelRatio: () => 1 },
    // A textured scene's: its pipelines write the feedback (`feedbackVariant.ts`).
    vis: { gpuHiz: {}, writesFeedback: true, writesEmissiveAo: true },
    run: { diagnostic: 'beauty' },
    layout: { clusters: { surfaces: createResidentSurfaces() } },
    blendState: { blendGpu: [], refracts: false, refractGranted: false },
    context: {},
    // The pass's level, as the engine's state holds it from its creation (`createWebgpuGpuState`):
    // the level's knobs shape the history `wanted` returns.
    gpu: { device, temporal, temporalLevel: 'max' },
    capture: { capturing: false },
    capabilities: { unsupported: [] as string[] },
    diag: { diagnosticFailure: (phase: string) => failures.push(phase) },
  } as unknown as WebgpuPagesRuntime
  return { rt, temporal, resized, failures }
}
