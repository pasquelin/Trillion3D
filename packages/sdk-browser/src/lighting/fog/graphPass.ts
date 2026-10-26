import type { FogGroups } from './passes.ts'
import type { FogVolumeResources } from './resources.ts'
import type { VoxelBuffers, VoxelGraphMaps } from './voxelGpu.ts'

/** The voxelisation of the graphs the objects of this image wear: its program asked of the set
 *  (the plain voxelisation serves until it is compiled), with the buffer of their values and, where
 *  one reads a texture, the colour atlas; none where they wear none, or the atlas is not there. */
export function graphPass(
  voxel: VoxelBuffers,
  resources: FogVolumeResources,
  groups: FogGroups,
  maps?: VoxelGraphMaps,
):
  | {
      program: ReturnType<FogVolumeResources['graphVoxelize']>
      groups: FogGroups['voxelizeGraph']
      values: VoxelBuffers['graphValues']
      atlas: ReturnType<VoxelGraphMaps['atlas']>
    }
  | undefined {
  const set = voxel.graphs
  if (!set) return undefined
  const atlas = set.textured ? maps?.atlas() : undefined
  if (set.textured && !atlas) return undefined
  return {
    program: resources.graphVoxelize(set),
    groups: groups.voxelizeGraph,
    values: voxel.graphValues,
    atlas,
  }
}
