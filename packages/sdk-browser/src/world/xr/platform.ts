/** Structural browser XR contracts: optional features are checked at the call site. */
export type XrMode = 'immersive-vr' | 'immersive-ar';
export type XrReference = 'local' | 'local-floor' | 'bounded-floor' | 'unbounded' | 'viewer';
export interface XrTransform {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  matrix: Float32Array;
  inverse: XrTransform;
}
export interface XrSpace extends EventTarget {
  getOffsetReferenceSpace(transform: XrTransform): XrSpace;
}
export interface XrView {
  eye: 'left' | 'right' | 'none';
  projectionMatrix: Float32Array;
  transform: XrTransform;
}
export interface XrInputSource {
  handedness: 'left' | 'right' | 'none';
  targetRayMode: 'gaze' | 'tracked-pointer' | 'screen';
  targetRaySpace: XrSpace;
  gripSpace?: XrSpace;
  gamepad?: Gamepad;
  profiles: readonly string[];
  hand?: ReadonlyMap<string, XrSpace>;
}
export interface XrHitSource {
  cancel(): void;
}
interface XrHit {
  getPose(space: XrSpace): { transform: XrTransform } | null;
}
export interface XrFrame {
  session: XrSession;
  getViewerPose(space: XrSpace): { views: readonly XrView[]; transform: XrTransform } | null;
  getPose(space: XrSpace, base: XrSpace): { transform: XrTransform } | null;
  getJointPose?(space: XrSpace, base: XrSpace): { transform: XrTransform; radius: number } | null;
  getHitTestResults?(source: XrHitSource): readonly XrHit[];
}
export interface XrSession extends EventTarget {
  inputSources: readonly XrInputSource[];
  visibilityState: string;
  frameRate?: number;
  enabledFeatures?: readonly string[];
  renderState: { baseLayer?: unknown; layers?: readonly unknown[] };
  requestReferenceSpace(type: XrReference): Promise<XrSpace>;
  requestAnimationFrame(callback: (time: number, frame: XrFrame) => void): number;
  cancelAnimationFrame(id: number): void;
  requestHitTestSource?(options: { space: XrSpace }): Promise<XrHitSource>;
  updateRenderState(state: Record<string, unknown>): void;
  end(): Promise<void>;
}
export interface XrSystem {
  isSessionSupported(mode: XrMode): Promise<boolean>;
  requestSession(
    mode: XrMode,
    options: {
      requiredFeatures?: readonly string[];
      optionalFeatures?: readonly string[];
    },
  ): Promise<XrSession>;
}
/** The browser grants XR only in a secure context and from a user activation. */
export const xrSystem = () =>
  (globalThis.navigator as (Navigator & { xr?: XrSystem }) | undefined)?.xr;
