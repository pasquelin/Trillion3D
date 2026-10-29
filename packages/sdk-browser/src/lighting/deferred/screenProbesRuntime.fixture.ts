// A runtime reduced to what the screen probes read of a frame, over the kit's device: the screen probes' tests and the occlusion's drive it.

import { VIEW_LAYOUT } from './worldAtWgsl.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createWebgpuViews } from '../../frame/backend/state/view.ts'
import { createWebgpuTimingState } from '../../frame/backend/state/timing.ts'
import { createWebgpuBlendState } from '../../blend/state.ts'
import { createScaleControl } from '../../frame/scale/scaleControl.ts'
import { createGpuHiz } from '../../visibility/hiz/gpu/factory.ts'
import { createScreenReflection } from '../reflections/gpu.ts'
import { placeScreenProbes, traceScreenProbes } from '../bounce/screen/frame.ts'
import { createDeferredLighting } from './deferred.ts'
import { gpuHarness } from './contractLighting.fixture.ts'

/** A whole image of the screen probes, the pool's pass between the placement and the trace left out: placed, then traced. */
export function encodeProbeImage(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  traceScreenProbes(rt, encoder, placeScreenProbes(rt, encoder))
}

/** A runtime reduced to what the screen probes read of a frame, over the kit's device: real lighting, depth
 *  pyramid and reflection, a G-buffer of stand-in views. */
export async function probesRuntime(options: Record<string, unknown> = {}) {
  const h = gpuHarness()
  const reflection = createScreenReflection(h.device, 64, 64, false)
  reflection.frame.depthDrawn = true
  const views = [h.view(), h.view(), h.view(), h.view()]
  const rt = {
    gpu: {
      device: h.device,
      reflection,
      deferred: await createDeferredLighting(h.device),
      surfaces: { views: () => views },
      targetSize: [64, 64],
      allocatedSize: [64, 64],
      screenProbes: undefined,
    },
    vis: { gpuHiz: await createGpuHiz(h.device, 64, 64), reflectionPipelines: {} },
    lights: { buffer: {} as GPUBuffer, store: { unlit: false } },
    blendState: createWebgpuBlendState(),
    run: { depthDrawn: true, diagnostic: 'beauty', frame: 0, gate: { temporalRevision: 0 } },
    bounce: { wanted: true, probes: undefined },
    setup: { viewport: [64, 64] },
    // A cut with no root: the surface cache finds neither compiled nor run-time cards.
    layout: { selectionRoots: [] },
    timing: createWebgpuTimingState(),
    context: options,
  } as unknown as WebgpuPagesRuntime
  // The views the cameras of the images before are kept by.
  rt.views = createWebgpuViews(rt, createScaleControl(1))
  // The kernels compile off the frame: the first image casts none, a later one does.
  const encode = async () => {
    for (let waited = 0; waited < 100; waited++) {
      const before = h.dispatches.length
      encodeProbeImage(rt, h.encoder)
      if (h.dispatches.length > before) return h
      await new Promise((done) => setImmediate(done))
    }
    throw new Error(rt.bounce.screen?.reason ?? 'the screen probes never cast')
  }
  return { h, rt, encode }
}

/** The words the lighting was last told of how to read the screen probes (`writeScreenProbes`). */
export const screenProbeWords = (h: { writes: { offset: number; data: unknown }[] }) => {
  const last = h.writes.filter((w) => w.offset === VIEW_LAYOUT.at.screenProbes * 4).at(-1)
  return last ? [...new Float32Array(last.data as ArrayLike<number>)] : []
}
