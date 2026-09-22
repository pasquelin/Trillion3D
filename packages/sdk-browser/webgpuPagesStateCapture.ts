import type { SurfaceCapture } from './surfaceBuffer.ts';

/** The second-view surface capture and the explicit readback of the main image. */
export interface WebgpuCaptureState {
  captureAllocationBytes: number;
  surfaceCapture: SurfaceCapture | undefined;
  /** A capture holds the engine: the image is rendered aside, into surfaces the host will own,
   *  so nothing presents, nothing feeds back and nothing is held until it is over. */
  capturing: boolean;
  surfaceRenderAllowed: boolean;
  capturedRevision: number;
  capturedPixels: Uint8Array | undefined;
  capturePending: Promise<void> | undefined;
  captureStreamingDeferrals: number;
  captureDeferralLogged: boolean;
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
    captureStreamingDeferrals: 0,
    captureDeferralLogged: false,
  };
}
