/** The version of this engine's package. */
export const SDK_VERSION = '0.2.0';
/** Cache format this runtime reads. Format 5 carries `scene-tables.json`, the node and material
 *  tables the prepared scene is checked against; formats 3 and 4 have no such product and are
 *  refused by their number rather than half-read. */
export const FORMAT_VERSION = 5;
/**
 * Cutout response sheet, mirroring `packages/asset-compiler-rust/src/cutout.rs`.
 *
 * The compiler writes this file and re-reads it; a host updates it with human responses.
 * It is the only format written by both languages, and its version governs how a reader
 * interprets it: unknown versions are rejected rather than guessed.
 */
export const CUTOUT_SHEET_FILE = 'decoupes.json';
/** The version of the cut-out answer sheet this runtime reads. */
export const CUTOUT_SHEET_VERSION = 1;
/** Outer cache format required for clustered BLEND; source manifests keep their own format. */
export const CLUSTERED_BLEND_FORMAT_VERSION = 6;
/** Cache identity for per-cluster DAG errors: group QEM error projected through the group sphere. */
export const DAG_ERROR_MODEL = 'dag-group-qem-v1';
/** The scope a model is compiled at when none is named: streamed in pages. */
export const DEFAULT_SCOPE: AssetScope = 'slice';
/** How a model is compiled: `'slice'` streams it in pages, `'full'` keeps it whole. */
export type AssetScope = 'slice' | 'full';
/** How far a compilation has got, step by step. */
export interface PreparationProgress {
  /** The step it is in. */
  phase: string;
  /** Work done. */
  completed: number;
  /** Work in all. */
  total: number;
  /** Words for a person to read. */
  message: string;
}
/** Where the camera stands and looks, with its optics, as the engine holds it. */
export interface CameraPose {
  /** Where the eye stands. */
  position: [number, number, number];
  /** The point it looks at. */
  target: [number, number, number];
  /** Field of view, in degrees. */
  fov: number;
  /** Nearest distance drawn. */
  near: number;
  /** Farthest distance drawn. */
  far: number;
}
/** One settled image of a view, as pixels, for comparing two renders. */
export interface StablePreview {
  /** The scope the model was read at. */
  scope: AssetScope;
  /** Which row comes first. */
  origin: 'bottom-left' | 'top-left';
  /** The pixels, four bytes each. */
  rgba: Uint8Array;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** The renderer that drew it. */
  backend: string;
}
