import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { MORTON } from '../../../hair/voxelMipWgsl.ts'

/**
 * THE WORDS OF THE VOXEL GRIDS, as the passes that fill and read them see them. A cell of the top level is one word: the index of its
 * bottom-level cells in the high bits and, in the low three, how many cells it has along a side (0: the cell is empty), or, while the
 * grid is being sized, the float its bottom level will be voxelled at. A cell of a majorant grid is two words, the greatest extinction
 * a float in the second. A colour (an extinction, an emission, a scattering albedo) is three half floats in two words, the third in the
 * low half of the second. A cleared top level holds 0xFFFFFFF8: no index, no cells.
 */
export const VG_TYPES_WGSL = wgslBlock(
  'VG_TYPES_WGSL',
  [MORTON],
  `const VG_EMPTY_INDEX=0x1FFFFFFFu;
fn vgLinearIndex(cell:vec3u,res:vec3i)->u32{
 return cell.z*u32(res.x*res.y)+cell.y*u32(res.x)+cell.x;
}
fn vgVoxelOf(index:u32,res:vec3i)->vec3u{
 let slice=u32(res.x*res.y);
 let z=index/slice;
 let rest=index-z*slice;
 return vec3u(rest%u32(res.x),rest/u32(res.x),z);
}
fn vgBottomIndex(word:u32)->u32{return word>>3u;}
fn vgIsAllocated(word:u32)->bool{return vgBottomIndex(word)!=VG_EMPTY_INDEX;}
fn vgIsBottomEmpty(word:u32)->bool{return (word&7u)==0u;}
fn vgSetBottomIndex(word:u32,index:u32)->u32{return (index<<3u)|(word&7u);}
fn vgSetBottomResolution(word:u32,res:u32)->u32{return (vgBottomIndex(word)<<3u)|(res&7u);}
fn vgVoxelSize(word:u32)->f32{return bitcast<f32>(word);}
fn vgMajorantOf(cell:vec2u)->f32{return bitcast<f32>(cell.y);}
fn vgSetMajorant(majorant:f32)->vec2u{return vec2u(0u,bitcast<u32>(majorant));}
fn vgColorOf(cell:vec2u)->vec3f{return vec3f(unpack2x16float(cell.x),unpack2x16float(cell.y&0xFFFFu).x);}
fn vgSetColor(color:vec3f)->vec2u{return vec2u(pack2x16float(color.xy),pack2x16float(vec2f(color.z,0.0)));}`,
)
