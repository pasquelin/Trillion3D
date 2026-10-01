/** Measured candidates only: no production quality policy is chosen by this spike. */
export interface RippleSpec {
  resolution: 256 | 384 | 512;
  rate: 7.5 | 15 | 30;
  extent?: number;
  depth?: number;
  damping?: number;
}
/** World x/z, radius in metres and height impulse in metres. */
export type Splat = readonly [number, number, number, number];
export interface RippleFrame {
  camera: readonly [number, number];
  splats: readonly Splat[];
}
export interface RippleWork {
  steps: number;
  splats: number;
  dropped: number;
  droppedSteps: number;
  recentered: boolean;
}
export const MAX_SPLATS = 64;
export const MAX_CATCHUP = 4;
