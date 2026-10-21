// The real engine draws the bench scene, twelve instances, its camera moving along the bench
// trajectory. After each frame, `transparentOcclusionAudit()` returns the transparent clusters the
// occlusion test removed, with their world corners in double precision, the matrices the test
// projected them with and the depth it rejected against; the reference refutes each on those same
// inputs (`transparentOcclusionReference.ts`).
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/diagnostic/types.ts'
import { readBounds } from '../../../bench/runner/harness/page.ts'
import { poseAt } from '../../../bench/runner/trajectory/poses.ts'
import { SDK_URL } from '../world/proofWorld.ts'
import { openEngineWorld, proofCanvas } from '../../kit/device/renderHarness.ts'
import { checkOcclusionAudit, emptyOcclusionTotals } from './transparentOcclusionReference.ts'

/** Frames of the bench trajectory, and how many poses spread along it are audited. */
const TRAJECTORY_FRAMES = 9 * 60

export interface AuditOptions {
  manifestUrl: string
  width: number
  height: number
  instances: 1 | 4 | 9 | 12
  pixelError: number
  maxPages: number
  /** Frames drawn at the first pose before any audit: residency fills first. */
  warmup: number
  poses: number
}

export async function auditPoses(options: AuditOptions) {
  const bounds = await readBounds({ sdkUrl: SDK_URL, manifestUrl: options.manifestUrl })
  const poses = Array.from({ length: options.poses }, (_, i) =>
    poseAt(bounds, Math.round((i * (TRAJECTORY_FRAMES - 1)) / (options.poses - 1))),
  )
  const events: EngineDiagnostic[] = []
  const world = await openEngineWorld(proofCanvas('transparent-occlusion-audit'), {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    replicaCount: options.instances,
    detail: 'source',
    pixelError: options.pixelError,
    maxResidentPages: options.maxPages,
    preload: 'visible',
    interactive: false,
    diagnosticDetail: 'summary',
    onDiagnostic: (event) => {
      if (/error|fallback|failed|lost/.test(event.phase)) events.push(event)
    },
  })
  world.setClearColor(0x2a303c)
  const occlusion = emptyOcclusionTotals()
  const occlusionViolations = [],
    frames = []
  try {
    world.setPose(poses[0])
    for (let i = 0; i < options.warmup; i++) {
      world.render(poses[0])
      await world.flush()
    }
    for (const pose of poses) {
      world.render(pose)
      await world.flush()
      const rejectedBefore = occlusion.rejected
      const rejects = await world.transparentOcclusionAudit()
      if (rejects) occlusionViolations.push(...checkOcclusionAudit(rejects, occlusion))
      frames.push({ transparentRejected: occlusion.rejected - rejectedBefore })
    }
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : ''
    return { error: String(error) + trace, events, frames }
  } finally {
    world.dispose()
  }
  return { events, frames, occlusion, occlusionViolations }
}
