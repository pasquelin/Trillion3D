import type * as THREE from 'three';
import type { SurfaceCapture } from './surfaceBuffer.ts';

/** The secondary-camera surface capture and the explicit readback of the main image. */
export interface WebgpuCaptureState {
  captureAllocationBytes: number;
  surfaceCapture: SurfaceCapture | undefined;
  secondaryCamera: THREE.PerspectiveCamera | undefined;
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
    secondaryCamera: undefined,
    surfaceRenderAllowed: false,
    capturedRevision: -1,
    capturedPixels: undefined,
    capturePending: undefined,
    captureStreamingDeferrals: 0,
    captureDeferralLogged: false,
  };
}
