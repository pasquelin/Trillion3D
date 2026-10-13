import type { CameraPose, DiagnosticMode } from '../../../../sdk-core/src/index.ts'
import type { PreparedExplorer } from '../session/prepare.ts'

/** The mutable state of one session; every service reads and writes this same object. */
export type SessionState = {
  disposed: boolean
  diagnostic: DiagnosticMode
  capturingSurface: boolean
  /** Frames drawn since the session opened: the frame number its diagnostics carry. */
  frame: number
  loaded: number
  pageBytesRead: number
}

export function createSessionState(prepared: PreparedExplorer, signal?: AbortSignal) {
  const { camera, center } = prepared
  // What the session read before its first frame — the pages it preloads among them — its queue
  // counted.
  const { loaded, bytesRead } = prepared.pageSources.streamer.stats()
  const state: SessionState = {
    disposed: false,
    diagnostic: 'beauty',
    capturingSurface: false,
    frame: 0,
    loaded,
    pageBytesRead: bytesRead,
  }
  /** What the session owns beside its engine — controls, listeners —, disposed with it. */
  const ownedControls: { dispose(): void }[] = []
  const lookAtTarget = center.clone()
  const check = () => {
    if (state.disposed) throw new Error('MeasuredWorld disposed')
    if (state.capturingSurface) throw new Error('SURFACE_CAPTURE_BUSY')
    signal?.throwIfAborted()
  }
  const setPose = (pose: CameraPose) => {
    camera.position.fromArray(pose.position)
    camera.fov = pose.fov
    camera.near = pose.near
    camera.far = pose.far
    camera.lookAt(lookAtTarget.fromArray(pose.target))
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }
  return { state, ownedControls, lookAtTarget, check, setPose }
}
