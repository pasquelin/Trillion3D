import type * as Sdk from '../../witnesses/measurement.ts'
import type {
  CameraPose,
  FrameMetrics,
  GpuPassTimings,
} from '../../../packages/sdk-core/src/index.ts'
import { poseAt } from '../trajectory/poses.ts'
import { streetBounds } from '../street/street.ts'
import { posterCapture } from '../harness/measurePage.ts'
import { captureConvergence, type ConvergenceProof } from './feedbackConvergencePage.ts'

type Reading = {
  target: boolean
  gpuFrameMs: number[]
  gpuPassSamples: GpuPassTimings[]
  counters: Partial<FrameMetrics>
  residency: Awaited<ReturnType<Sdk.Engine['feedbackAbResidency']>>
  capture: string
}

export type FeedbackTargetResult = {
  supported: boolean
  reason: string | null
  pose: CameraPose | null
  readings: Reading[]
  convergence: ConvergenceProof | null
}

/** One page, one device, one pose. The feedback-target A/B switch never reloads pages or the
 *  scene. */
export async function runFeedbackTarget(options: {
  sdkUrl: string
  manifestUrl: string
  scene: string
  view: number
  frames: number
  pixelError: number
}): Promise<FeedbackTargetResult> {
  const sdk = (await import(options.sdkUrl)) as typeof Sdk
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  let convergence: ConvergenceProof | null = null
  const unsupported = (reason: string): FeedbackTargetResult => ({
    supported: false,
    reason,
    pose: null,
    readings: [],
    convergence,
  })
  let explorer: Sdk.MeasuredWorld | undefined
  try {
    explorer = await sdk.openMeasuredWorld(canvas, {
      manifestUrl: options.manifestUrl,
      scope: 'full',
      width: 2496,
      height: 1404,
      pixelRatio: 1,
      replicaCount: 1,
      detail: 'source',
      pixelError: options.pixelError,
      lodAdaptive: false,
      preload: 'visible',
      engine: sdk.webgpuPagesEngine,
      clearColor: 0x2a303c,
      diagnosticDetail: 'summary',
      textureSource: 'cache',
      temporalAntialiasing: true,
      stageProfile: true,
      feedbackTargetAB: true,
    })
    const backend = explorer.engine as Sdk.Engine
    // The box and the street the bench's eye-level views walk (`street/street.ts`), read in this page.
    const bounds = await streetBounds(options)
    const pose = poseAt(bounds, options.view)
    explorer.setPose(pose)
    convergence = await captureConvergence(
      explorer,
      backend,
      pose,
      `${options.scene}-${options.view}`,
      canvas,
    )
    if (!convergence.supported) return unsupported(convergence.reason!)
    const readings: Reading[] = []
    for (const [index, target] of [true, false, true].entries()) {
      await backend.setFeedbackTargetAb(target)
      const gpuFrameMs: number[] = []
      const gpuPassSamples: GpuPassTimings[] = []
      let last: FrameMetrics | null = null
      let seen = -1,
        warmFrame = -1
      // The first frames after a toggle are outside the timed window.
      for (let i = 0; i < options.frames + 12; i++) {
        await new Promise<number>((done) => requestAnimationFrame(done))
        last = explorer.render(pose)
        const sample = last.gpuPassMs
        if (i < 12) {
          if (sample) warmFrame = Math.max(warmFrame, sample.frame)
          continue
        }
        if (!sample || sample.frame <= warmFrame || sample.frame === seen) continue
        seen = sample.frame
        gpuPassSamples.push(sample)
        if (typeof last.gpuFrameMs === 'number') gpuFrameMs.push(last.gpuFrameMs)
      }
      if (!last) return unsupported('FEEDBACK_AB_NO_FRAME')
      const capture = `${options.scene}-${options.view}-${index}.rgba`
      const residency = await backend.feedbackAbResidency()
      const response = await posterCapture(
        capture,
        await backend.captureFeedbackAb(),
        canvas.width,
        canvas.height,
      )
      if (!response.ok) return unsupported(`FEEDBACK_AB_CAPTURE_${response.status}`)
      readings.push({
        target,
        gpuFrameMs,
        gpuPassSamples,
        residency,
        // The last frame's whole metrics: target bytes, residency and tile counters among them.
        counters: last,
        capture,
      })
    }
    return {
      supported: true,
      reason: null,
      pose,
      readings,
      convergence,
    }
  } catch (error) {
    return unsupported(String(error))
  } finally {
    explorer?.dispose()
    canvas.remove()
  }
}
