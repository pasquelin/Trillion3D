import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/** The bytes of the parameters every sparse voxel kernel reads (`SvParams`). */
export const SV_PARAMS_BYTES = 64

/** The threads a row of an indirect dispatch holds (32768 groups of 64): a list longer than that wraps to the next row, which a 1D dispatch
 *  past 65535 groups could not do. */
export const SV_ROW_THREADS = 32768 * 64

/**
 * THE SPARSE VOXELS' WORDS: a voxel is two words, its linear index in the grid of its mip level and the level. The parameters every kernel
 * shares: `resolution` the grid the kernel reads (the min texture's, or the mip's), `mip` the level of the voxels it emits, `volumeResolution`
 * the volume's at mip 0, and the volume's local bounds (the box the grid spans).
 */
export const SV_VOXEL_DATA_WGSL = wgslBlock(
  'SV_VOXEL_DATA_WGSL',
  [],
  `struct SvParams{
 resolution:vec3u,
 mip:u32,
 volumeResolution:vec3u,
 pad0:u32,
 boundsOrigin:vec3f,
 pad1:f32,
 boundsExtent:vec3f,
 pad2:f32,
}
const SV_ROW_THREADS=${SV_ROW_THREADS}u;
fn svEncodeVoxel(index:vec3u,mip:u32,res:vec3u)->vec2u{
 return vec2u(index.z*res.x*res.y+index.y*res.x+index.x,mip);
}
/** The voxel index of a packed voxel in the grid of its level, the volume's size at mip 0 shifted down and held to one. */
fn svDecodeVoxel(packed:vec2u,volumeResolution:vec3u)->vec3u{
 let res=max(volumeResolution>>vec3u(packed.y),vec3u(1u));
 let plane=res.x*res.y;
 let inPlane=packed.x%plane;
 return vec3u(inPlane%res.x,inPlane/res.x,packed.x/plane);
}
/** The box of the cell of a grid cut mip levels coarser than the volume (the cells of volumeResolution it spans, held inside the volume, so that a
 *  volume whose sides are not powers of two is covered to its edge): the bounds cut into it, widened by a hair. */
fn svCellBounds(cell:vec3u,mip:u32,volumeResolution:vec3u,lo:vec3f,size:vec3f)->array<vec3f,2>{
 let res=vec3f(volumeResolution);
 let first=vec3f(cell<<vec3u(mip));
 let last=min(vec3f((cell+vec3u(1u))<<vec3u(mip)),res);
 let epsilon=vec3f(0.0001);
 return array<vec3f,2>(lo+size*(first/res)-epsilon,lo+size*(last/res)+epsilon);
}
/** The box of a voxel in the volume's local space. */
fn svVoxelBounds(packed:vec2u,p:SvParams)->array<vec3f,2>{
 return svCellBounds(svDecodeVoxel(packed,p.volumeResolution),packed.y,p.volumeResolution,p.boundsOrigin-p.boundsExtent,p.boundsExtent*2.0);
}`,
)
