import type { ReflectionMetadata } from './historyTargets.ts';
import {
  REFLECTION_CHANGE_FRAMES,
  REFLECTION_CHANGE_WEIGHT,
  REFLECTION_HISTORY_WEIGHT,
  REFLECTION_MOVING_WEIGHT,
} from './resolveWgsl.ts';

/** Versions that place a reflected source, and that light it (`reflectionFrame.ts`). */
export const REFLECTION_PLACEMENT_VERSIONS = 7;
export const REFLECTION_LIGHTING_VERSIONS = 2;

export interface ReflectionHistoryFrame {
  metadata: ReflectionMetadata;
  pages: GPUBuffer;
  /** The temporal pass's placement motion (`liveMotion`), live this image unless it is `pages`:
   *  a moved source is then reprojected, never a reason to reset. */
  motion: GPUBuffer;
  /** The render origin the motion is written at, where both matrices are anchored. */
  eye: ArrayLike<number>;
  /** What placed the reflected points (`reflectionFrame.ts`), compared number by number: no
   *  string a frame. Its change is followed. */
  epoch: Float64Array;
  /** What lit them, lights and materials: its change resets the history. */
  lighting: Float64Array;
  seed: number;
  frame: number;
  /** Unjittered camera; jitter must not reopen a completed filter window. */
  camera: ArrayLike<number>;
}

/** The weight a history may keep this image: `REFLECTION_CHANGE_WEIGHT` for
 *  `REFLECTION_CHANGE_FRAMES` after a placement change the motion did not follow (#33),
 *  `REFLECTION_MOVING_WEIGHT` while its sources or camera move, the full window otherwise. */
export function historyConfidence(followed: boolean, sinceChange: number, moving: boolean) {
  if (!followed && sinceChange < REFLECTION_CHANGE_FRAMES) return REFLECTION_CHANGE_WEIGHT;
  return moving ? REFLECTION_MOVING_WEIGHT : REFLECTION_HISTORY_WEIGHT;
}
