import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HAIR_VOXEL_BITS } from './voxelRasterWgsl.ts'
import { HAIR_VOXEL_PAGE_GROUP } from './voxelMath.ts'
import { VOXEL_COMMON_WGSL, VOXEL_PARAMS_WGSL } from './voxelWgsl.ts'

const [GX, GZ] = HAIR_VOXEL_PAGE_GROUP

/**
 * THE LEVELS OF A PAGE, and where a voxel of a level is: the words of the pages follow each other, a
 * page's levels one after the other (each `n = pageResolution >> level` voxels a side, the coordinates x
 * first), `levelOffset` the words before a level. Reads `params` (the page resolution and stride).
 */
export const VOXEL_LEVELS_WGSL = wgslBlock(
  'HAIR_VOXEL_LEVELS_WGSL',
  [VOXEL_COMMON_WGSL],
  `fn levelOffset(level:u32)->u32{
 var words=0u;
 for(var l=0u;l<level;l++){
  let n=params.pageResolution>>l;
  words+=n*n*n;
 }
 return words;
}
// The word of the voxel \`at\` (within its page, at the level's own resolution) of \`level\` of page \`page\`.
fn levelVoxelAt(page:u32,level:u32,at:vec3u)->u32{
 let n=params.pageResolution>>level;
 return page*params.pageStride+levelOffset(level)+at.x+at.y*n+at.z*n*n;
}`,
)

export const MORTON = wgslBlock(
  'HAIR_VOXEL_MORTON_WGSL',
  [],
  `fn mortonCode3(x:u32)->u32{
 var v=x&0x3ffu;
 v=(v|(v<<16u))&0x030000ffu;
 v=(v|(v<<8u))&0x0300f00fu;
 v=(v|(v<<4u))&0x030c30c3u;
 v=(v|(v<<2u))&0x09249249u;
 return v;
}
fn reverseMortonCode3(x:u32)->u32{
 var v=x&0x09249249u;
 v=(v|(v>>2u))&0x030c30c3u;
 v=(v|(v>>4u))&0x0300f00fu;
 v=(v|(v>>8u))&0x030000ffu;
 v=(v|(v>>16u))&0x000003ffu;
 return v;
}
fn mortonEncode3(v:vec3u)->u32{return mortonCode3(v.x)|(mortonCode3(v.y)<<1u)|(mortonCode3(v.z)<<2u);}
fn mortonDecode3(m:u32)->vec3u{return vec3u(reverseMortonCode3(m),reverseMortonCode3(m>>1u),reverseMortonCode3(m>>2u));}`,
)

/**
 * THE DENSITY OF A VOXEL OF THE NEXT LEVEL from the eight below it: the opaque mark is the mean of theirs
 * (at least 1 where any holds one), the hair is the mean of the hair (at least 1 where any holds some, so
 * that a page with any hair is never taken for empty), and the voxel casts no hair shadow unless one of
 * the eight that holds hair does.
 */
const MIP_DENSITY = wgslBlock(
  'HAIR_VOXEL_MIP_DENSITY_WGSL',
  [],
  `fn mipDensity(raw:array<u32,8>)->u32{
 var opaque=0.0;
 var hair=0u;
 var caster=false;
 for(var k=0u;k<8u;k++){
  opaque+=f32((raw[k]&${HAIR_VOXEL_BITS.opaqueMask}u)>>24u);
  let own=raw[k]&${HAIR_VOXEL_BITS.hairMask}u;
  hair+=own;
  caster=caster||(own>0u&&(raw[k]&${HAIR_VOXEL_BITS.noShadow}u)==0u);
 }
 let outOpaque=u32(clamp(opaque/8.0,select(0.0,1.0,opaque>0.0),127.0))<<24u;
 let outHair=min(${HAIR_VOXEL_BITS.hairMask}u,select(0u,max(hair/8u,1u),hair>0u));
 return outHair|outOpaque|select(${HAIR_VOXEL_BITS.noShadow}u,0u,caster);
}`,
)

/** The eight voxels of the level below that make the voxel \`outVoxel\` of a page's level. */
const READ_EIGHT = `fn readEight(page:u32,source:u32,outVoxel:vec3u)->array<u32,8>{
 let below=outVoxel<<vec3u(1u);
 var raw:array<u32,8>;
 for(var k=0u;k<8u;k++){
  raw[k]=voxels[levelVoxelAt(page,source,below+vec3u(k&1u,(k>>1u)&1u,(k>>2u)&1u))];
 }
 return raw;
}`

/** The dispatch over the pages for each level above the first: its x count is the workgroups the level's
 *  voxels fill, its y and z those of the dispatch over all the pages. */
export const MIP_ARGS_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> voxelArgs:array<u32>;
@group(0) @binding(2) var<storage,read_write> mipArgs:array<u32>;
@compute @workgroup_size(1) fn hairVoxelMipArgs(){
 var level=1u;
 loop{
  let n=params.pageResolution>>level;
  if(n==0u){break;}
  let at=level*3u;
  mipArgs[at]=(n*n*n+${GX - 1}u)/${GX}u;
  mipArgs[at+1u]=voxelArgs[1];
  mipArgs[at+2u]=voxelArgs[2];
  level++;
 }
}`,
  [VOXEL_PARAMS_WGSL],
)

/**
 * THE NEXT LEVEL OF EVERY ALLOCATED PAGE, from `TARGET - 1`: a thread a voxel of the level made, its eight
 * below read and reduced (`mipDensity`), the voxels taken in the order of a Morton code. The entry that
 * ends on the level of 4 voxels a side (`hairVoxelMipAggregate`) reduces it further in the workgroup, to
 * the level of 2 and the level of 1; and where the settings invalidate the empty pages (`PATCH_EMPTY`), a
 * page whose last voxel holds no hair is taken out of the page index, so that the march does not enter it.
 */
export const MIP_WGSL = wgslProgram(
  `override TARGET:u32=1u;
override PATCH_EMPTY:u32=0u;
@group(0) @binding(1) var<storage,read> counter:array<u32>;
@group(0) @binding(2) var<storage,read_write> voxels:array<u32>;
@group(0) @binding(3) var<storage,read> pageToPageIndex:array<u32>;
@group(0) @binding(4) var<storage,read_write> pageIndex:array<u32>;
var<workgroup> density4:array<u32,${64 * GZ}>;
var<workgroup> density2:array<u32,${8 * GZ}>;
${READ_EIGHT}
@compute @workgroup_size(${GX},1,${GZ}) fn hairVoxelMip(@builtin(global_invocation_id) id:vec3u){
 let outResolution=params.pageResolution>>TARGET;
 if(id.z>=counter[0]||id.x>=outResolution*outResolution*outResolution){return;}
 let outVoxel=mortonDecode3(id.x);
 voxels[levelVoxelAt(id.z,TARGET,outVoxel)]=mipDensity(readEight(id.z,TARGET-1u,outVoxel));
}
@compute @workgroup_size(${GX},1,${GZ}) fn hairVoxelMipAggregate(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) local:vec3u){
 let page=id.z;
 let valid=page<counter[0];
 if(valid&&id.x<64u){
  let outVoxel=mortonDecode3(id.x);
  let total=mipDensity(readEight(page,TARGET-1u,outVoxel));
  voxels[levelVoxelAt(page,TARGET,outVoxel)]=total;
  density4[mortonEncode3(outVoxel)*${GZ}u+local.z]=total;
 }
 workgroupBarrier();
 if(valid&&local.x<8u){
  var raw:array<u32,8>;
  for(var k=0u;k<8u;k++){raw[k]=density4[(local.x*8u+k)*${GZ}u+local.z];}
  let total=mipDensity(raw);
  let store=mortonDecode3(local.x*8u)>>vec3u(1u);
  density2[mortonEncode3(store)*${GZ}u+local.z]=total;
  voxels[levelVoxelAt(page,TARGET+1u,store)]=total;
 }
 workgroupBarrier();
 if(valid&&local.x<1u){
  var raw:array<u32,8>;
  for(var k=0u;k<8u;k++){raw[k]=density2[k*${GZ}u+local.z];}
  let total=mipDensity(raw);
  voxels[levelVoxelAt(page,TARGET+2u,vec3u(0u))]=total;
  if(PATCH_EMPTY!=0u&&(total&${HAIR_VOXEL_BITS.hairMask}u)==0u){pageIndex[pageToPageIndex[page]]=0xFFFFFFFFu;}
 }
}`,
  [VOXEL_PARAMS_WGSL, VOXEL_LEVELS_WGSL, MORTON, MIP_DENSITY],
)
