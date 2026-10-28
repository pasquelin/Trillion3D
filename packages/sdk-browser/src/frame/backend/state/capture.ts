import type { SurfaceCapture } from '../../../materials/surface/surfaceBuffer.ts'

/** The second-view surface capture and the explicit readback of the main image. */
export interface WebgpuCaptureState {
  captureAllocationBytes: number
  surfaceCapture: SurfaceCapture | undefined
  /** A capture holds the engine: the image is rendered aside, into surfaces the host will own,
   *  so nothing presents, nothing feeds back and nothing is held until it is over. */
  capturing: boolean
  surfaceRenderAllowed: boolean
  capturedRevision: number
  capturedPixels: Uint8Array | undefined
  capturePending: Promise<Uint8Array> | undefined
  /** The image revision the pending read was started at. */
  pendingRevision: number
  captureStreamingDeferrals: number
  captureDeferralLogged: boolean
}

/** The main image read back is forgotten: the targets it was read from are gone. */
export function forgetCapturedImage(capture: WebgpuCaptureState) {
  capture.capturedPixels = undefined
  capture.capturedRevision = -1
}

export function createWebgpuCaptureState(): WebgpuCaptureState {
  return {
    captureAllocationBytes: 0,
    surfaceCapture: undefined,
    capturing: false,
    surfaceRenderAllowed: false,
    capturedRevision: -1,
    capturedPixels: undefined,
    capturePending: undefined,
    pendingRevision: -1,
    captureStreamingDeferrals: 0,
    captureDeferralLogged: false,
  }
}
