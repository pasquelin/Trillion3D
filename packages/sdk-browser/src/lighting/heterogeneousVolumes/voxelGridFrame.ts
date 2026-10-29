import type { FrameContext } from './liveShadingContext.ts'
import { encodeVoxelGridDebug } from './voxelGridDebug.ts'
import { encodeVoxelGridShadows } from './voxelGridShadows.ts'
import { gridDebugModeOf, usesVoxelGrids } from './voxelGridSettings.ts'

/** Whether the voxel grids are built for this image: while the shadows are made through them (`ShouldBuildVoxelGrids`, `HeterogeneousVolumes.cpp:910`). */
export const buildsVoxelGrids = (c: Pick<FrameContext, 'settings'>) => usesVoxelGrids(c.settings)

/**
 * The part of the image the voxel grids take over, none where they take none: in the shadows phase while the shadows are made through the grids, the
 * grids built and the lights' maps rendered through them; in the image phase while a debug mode asks (the setting or a diagnostic view), the volumes
 * replaced by the transmittance through the grids (`HeterogeneousVolumes.cpp:1145`). Whether it took the phase over.
 */
export function encodeVoxelGridPhase(c: FrameContext): boolean {
  if (c.shadowed) {
    if (!buildsVoxelGrids(c)) return false
    encodeVoxelGridShadows(c)
    return true
  }
  const mode = gridDebugModeOf(c.rt.run.diagnostic, c.settings)
  if (mode === 0) return false
  encodeVoxelGridDebug(c, mode)
  return true
}
