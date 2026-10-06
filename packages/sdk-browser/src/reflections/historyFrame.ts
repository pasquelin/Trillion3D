import type { ReflectionMetadata } from './historyTargets.ts'
import {
  REFLECTION_CHANGE_FRAMES,
  REFLECTION_CHANGE_KEPT,
  REFLECTION_STILL_FRAMES,
} from './resolveWgsl.ts'

/** Versions that place a reflected source, and that light it (`reflectionFrame.ts`). */
export const REFLECTION_PLACEMENT_VERSIONS = 7
export const REFLECTION_LIGHTING_VERSIONS = 2

export interface ReflectionHistoryFrame {
  metadata: ReflectionMetadata
  /** This image's identifiers as the reflection source binds them (`source.ts`). */
  ids: GPUTextureView
  pages: GPUBuffer
  /** The temporal pass's placement motion (`reflectionFrame.ts`), live this image unless it is `pages`:
   *  a moved source is then reprojected, never a reason to reset. */
  motion: GPUBuffer
  /** The render origin the motion is written at, where both matrices are anchored. */
  eye: ArrayLike<number>
  /** What placed the reflected points (`reflectionFrame.ts`), compared number by number: no
   *  string a frame. Its change is followed. */
  epoch: Float64Array
  /** What lit them, lights and materials: its change resets the history. */
  lighting: Float64Array
  seed: number
  frame: number
  /** Unjittered camera; jitter must not reopen a completed filter window. */
  camera: ArrayLike<number>
}

/** The frames of its own weight a history may keep this image (`resolveWgsl.ts`):
 *  `REFLECTION_CHANGE_KEPT` for `REFLECTION_CHANGE_FRAMES` after a placement change the motion did
 *  not follow (#33) or a relight (#1342), the still window otherwise, and while `followed`: an
 *  image the clip follows a relight on. While its sources or camera move the window is kept whole
 *  and the history clipped to the image's neighbourhood instead (#831). */
export function historyConfidence(followed: boolean, sinceChange: number) {
  if (!followed && sinceChange < REFLECTION_CHANGE_FRAMES) return REFLECTION_CHANGE_KEPT
  return REFLECTION_STILL_FRAMES
}
