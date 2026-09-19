export const SDK_VERSION = '0.1.0';
/** Cache format this runtime reads. Format 3 carries the per-cluster coplanar depth layer, which
 *  decides which of two exactly coplanar opaque surfaces draws on top; formats 1 and 2 have no such
 *  column and are refused rather than half-read. */
export const FORMAT_VERSION = 3;
/**
 * Cutout response sheet, mirroring `packages/asset-compiler-rust/src/cutout.rs`.
 *
 * The compiler writes this file and re-reads it; a host updates it with human responses.
 * It is the only format written by both languages, and its version governs how a reader
 * interprets it: unknown versions are rejected rather than guessed.
 */
export const CUTOUT_SHEET_FILE = 'decoupes.json';
export const CUTOUT_SHEET_VERSION = 1;
/** Outer cache format required for clustered BLEND; source manifests keep their own format. */
export const CLUSTERED_BLEND_FORMAT_VERSION = 4;
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
