// The real engine draws the bench scene, twelve instances, its camera moving along the bench
// trajectory. After each frame, `partitionAudit()` returns what the GPU partition wrote — the
// screen rectangle and depth bound of every resident row — with the world corners in double
// precision and the matrices it drew them from; the reference is recomputed on those same inputs
// (`partitionReference.ts`). The transparent clusters the occlusion test removed are refuted the
// same way (`transparentOcclusionReference.ts`).
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import { readBounds } from '../../../bench/runner/harness/page.ts'
import { poseAt } from '../../../bench/runner/trajectory/poses.ts'
import { SDK_URL } from '../world/proofWorld.ts'
import { openEngineWorld, proofCanvas } from '../kit/renderHarness.ts'
import { compareAudit, emptyTotals } from './partitionReference.ts'
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
  const world = await openEngineWorld(proofCanvas('partition-audit'), {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    replicaCount: options.instances,
    detail: 'source',
    pixelError: options.pixelError,
    lodAdaptive: false,
    maxResidentPages: options.maxPages,
    preload: 'visible',
    interactive: false,
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
    onDiagnostic: (event) => {
      if (/error|fallback|failed|lost/.test(event.phase)) events.push(event)
    },
  })
  const total = emptyTotals(),
    occlusion = emptyOcclusionTotals()
  const occlusionViolations = [],
    frames = []
  try {
    world.setPose(poses[0])
    for (let i = 0; i < options.warmup; i++) {
      world.render(poses[0])
      await world.flush()
    }
    for (const pose of poses) {
      const metrics = world.render(pose)
      await world.flush()
      const audit = await world.partitionAudit()
      if (!audit) return { error: 'no GPU partition: the audit returned nothing', events }
      const rowsBefore = total.rows,
        clippedBefore = total.clipped,
        rejectedBefore = occlusion.rejected
      compareAudit(audit, total)
      // Transparent clusters are no rows: their audit is apart, and bears on what the GPU removed.
      const rejects = await world.transparentOcclusionAudit()
      if (rejects) occlusionViolations.push(...checkOcclusionAudit(rejects, occlusion))
      frames.push({
        rows: total.rows - rowsBefore,
        clipped: total.clipped - clippedBefore,
        transparentRejected: occlusion.rejected - rejectedBefore,
        hizTestedClusters: metrics?.hizTestedClusters ?? null,
        hizRejectedClusters: metrics?.hizRejectedClusters ?? null,
      })
    }
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : ''
    return { error: String(error) + trace, events, frames, total }
  } finally {
    world.dispose()
  }
  return { events, frames, total, occlusion, occlusionViolations }
}
