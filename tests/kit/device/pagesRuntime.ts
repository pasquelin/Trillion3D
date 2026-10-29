// The engine's runtime read from outside, for a proof that must see what a frame left in it — the
// cut's tables, the roots in their order — beside the world it opened. The session builds its engine
// from a factory (`MeasuredWorldOptions.engine`) and keeps the runtime inside it; this factory makes
// the page raster's runtime itself, keeps it, and hands it to the page raster's own factory
// (`webgpuPagesEngine(context, runtime)`), which takes a runtime to use in place of making one.
import type { EngineFactory } from '../../../packages/sdk-browser/src/session/engine/factory.ts'
import {
  createWebgpuPagesRuntime,
  type WebgpuPagesRuntime,
} from '../../../packages/sdk-browser/src/frame/backend/runtime.ts'
import { webgpuPagesEngine } from '../../../packages/sdk-browser/src/frame/backend/pages.ts'
import {
  unsettledMask,
  unsettledReasons,
} from '../../../packages/sdk-browser/src/frame/loop/unsettled.ts'
import { everyImageTerms } from '../../../packages/sdk-browser/src/frame/loop/everyImage.ts'

/** The page raster as an engine factory, and the runtime of the engine it built last. */
export function runtimeKeepingEngine() {
  let kept: WebgpuPagesRuntime | undefined
  const factory: EngineFactory = (context) =>
    webgpuPagesEngine(context, (kept = createWebgpuPagesRuntime(context)))
  return { factory, runtime: () => kept }
}

/** What keeps a view of `rt` drawing, named: the unsettled terms, the terms drawn every image,
 *  whether the view stands, and where its temporal pass stands against its history (`taaConverged`)
 *  — for a proof whose view never held. */
export function whyNotHeld(rt: WebgpuPagesRuntime | undefined) {
  if (!rt) return undefined
  const taa = rt.gpu.temporal?.frame
  return {
    unsettled: unsettledReasons(unsettledMask(rt, rt.run.frame)),
    everyImage: everyImageTerms(rt),
    standing: rt.run.gate.held(),
    taa: taa && {
      accumulated: taa.accumulated,
      phases: taa.phases,
      sample: taa.sample,
      hasHistory: taa.hasHistory,
      historyScale: taa.historyScale,
      render: rt.gpu.targetSize[0],
      display: rt.gpu.displaySize[0],
    },
  }
}
