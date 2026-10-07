import { enginePose, type EngineCamera } from '../../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** Every full frame snapshot starts from the same identity: backend, frame, submission, pose and
 *  the CPU sample; callers append only what their selection path knows. */
export function frameTraceSnapshot<T extends object>(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  selection: { source: 'gpu'; decision: string },
  rest: T,
) {
  return {
    frame: rt.run.frame,
    submission: rt.run.imageRevision,
    pose: enginePose(cam),
    source: selection.source,
    selection,
    cpu: rt.timing.cpuSample,
    ...rest,
  }
}
