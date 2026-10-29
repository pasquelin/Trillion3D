type Vec3 = readonly [number, number, number]

/** The voxels of a grid of `resolution`. */
export const voxelCountOf = (resolution: Vec3) => resolution[0] * resolution[1] * resolution[2]

/** The volume's resolution at a mip level: each side shifted down, held to one. */
export const mipVolumeResolution = (resolution: Vec3, mip: number): [number, number, number] => [
  Math.max(resolution[0] >> mip, 1),
  Math.max(resolution[1] >> mip, 1),
  Math.max(resolution[2] >> mip, 1),
]

/** The mip levels the min texture of `resolution` holds when its chain goes down to one voxel. */
export const mipCountOf = (resolution: Vec3) => Math.floor(Math.log2(Math.max(...resolution))) + 1

/** The mip bias of the sparse voxels' generation: the setting held to 0-10 (the texture's own count is the bound the refinement stops at). */
export const sparseVoxelMipBias = (setting: number) =>
  Math.min(Math.max(Math.trunc(setting), 0), 10)

/** The bytes the voxel list of a min texture of `resolution` takes at most (every voxel, two words), and a counter's (one word). */
export const voxelListBytes = (resolution: Vec3) => voxelCountOf(resolution) * 8
export const SV_COUNTER_BYTES = 4
/** The bytes of the indirect arguments (three words). */
export const SV_ARGS_BYTES = 12
