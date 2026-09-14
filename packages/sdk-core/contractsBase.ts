export const SDK_VERSION = '0.1.0';
export const FORMAT_VERSION = 1;
/** Outer cache format required for clustered BLEND; source manifests remain format 1. */
export const CLUSTERED_BLEND_FORMAT_VERSION = 2;
/** Cache identity for per-cluster DAG errors: group QEM error projected through the group sphere. */
export const DAG_ERROR_MODEL = 'dag-group-qem-v1';
export const DEFAULT_SCOPE: AssetScope = 'slice';
export type AssetScope = 'slice' | 'full';
export interface PreparationProgress {
  phase: string;
  completed: number;
  total: number;
  message: string;
}
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  near: number;
  far: number;
}
export interface StablePreview {
  scope: AssetScope;
  origin: 'bottom-left' | 'top-left';
  rgba: Uint8Array;
  width: number;
  height: number;
  backend: string;
}
