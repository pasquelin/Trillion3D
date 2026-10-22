import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS as INFLUENCE_VOXELS } from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { unorm8Byte } from '../../../../math/src/wgsl/color.ts'
import { ATLAS_FETCH_WGSL } from './atlasFetchWgsl.ts'

/**
 * THE COARSE MIP OF A CLIPMAP, and the fill of the page tables.
 *
 * The coarse mip is a volume of `resolution` voxels along a side — the clipmap's voxels divided by the
 * mip factor — that holds, for every position, a distance that is never wrong by more than the
 * pages hold, even where no page is allocated, so that a ray can step through empty space in long
 * strides (`../../../../sdk-core/src/lighting/globalDistanceField.ts`). Its first propagation reads the
 * pages: the voxel's centre is carried to the page table through the clipmap's scroll, the page's
 * distance read with a trilinear filter and mapped to the mip's range (`scale` and `bias`); a
 * voxel with no page holds 1. Each of the four steps after it takes, from the volume the step
 * before wrote, the smaller of the voxel's distance and the distance an Eikonal update from its six
 * neighbours' smallest values gives, with the neighbours' distances sorted: one, two or three
 * directions, a step being half the range over four voxels. The steps alternate between the mip
 * and a volume beside it so the last one lands in the mip. A value is stored as a byte, as the pages are.
 * An update with no real solution is not taken.
 */

/** The block of one propagation: the mip's size, where its volume starts, the scroll, the scale. */
export const MIP_BLOCK = fieldLayout('DfMip', [
  ['resolution', 'u32'],
  ['clipmap', 'u32'],
  ['offsetZ', 'u32'],
  ['pagesAlong', 'u32'],
  ['scroll', 'vec3f'],
  ['invResolution', 'f32'],
  ['readPages', 'u32'],
  ['scale', 'f32'],
  ['bias', 'f32'],
  ['padA', 'f32'],
] as const)

/** The bytes a block is given: a dynamic offset's alignment. */
export const MIP_BLOCK_BYTES = 256

/** The entries. */
export const MIP_ENTRIES = { propagate: 'propagateMipDistance', fill: 'fillPageTable' } as const

const STEP = 1 / (2 * INFLUENCE_VOXELS)

/** `propagateMipDistance`, bindings 0 to 4 of group 0 (`mipLayoutEntries`). */
export const MIP_SHADER = wgslProgram(
  `${MIP_BLOCK.wgsl}
@group(0) @binding(0) var<uniform> mip:DfMip;
@group(0) @binding(1) var pageTable:texture_3d<u32>;
@group(0) @binding(2) var<storage,read> gdfPageAtlas:array<u32>;
@group(0) @binding(3) var previous:texture_3d<f32>;
@group(0) @binding(4) var next:texture_storage_3d<r32float,write>;
const GDF_INVALID_PAGE=0xFFFFFFFFu;
const STEP:f32=${STEP};
fn previousDistance(coord:vec3i,offset:vec3i)->f32{
 let c=clamp(coord+offset,vec3i(0),vec3i(i32(mip.resolution)-1));
 if(mip.readPages==0u){return textureLoad(previous,c+vec3i(0,0,i32(mip.offsetZ)),0).x;}
 let uv=fract(fract((vec3f(c)+0.5)*mip.invResolution+mip.scroll));
 let along=f32(mip.pagesAlong);
 let packed=textureLoad(pageTable,vec3i(saturate(uv)*along)+vec3i(0,0,i32(mip.clipmap*mip.pagesAlong)),0).x;
 if(packed==GDF_INVALID_PAGE){return 1.0;}
 let value=gdfAtlasSample(packed&0x00FFFFFFu,fract(uv*along)*7.0);
 return select(value,value*mip.scale+mip.bias,value<1.0);
}
fn eikonal2(x:f32,y:f32)->f32{
 let sum=x+y;
 let root=sum*sum-2.0*(x*x+y*y-STEP*STEP);
 return select(0.5*(sum+sqrt(max(root,0.0))),3.4e38,root<0.0);
}
fn eikonal3(x:f32,y:f32,z:f32)->f32{
 let sum=x+y+z;
 let root=sum*sum-3.0*(x*x+y*y+z*z-STEP*STEP);
 return select((sum+sqrt(max(root,0.0)))/3.0,3.4e38,root<0.0);
}
@compute @workgroup_size(4,4,4) fn ${MIP_ENTRIES.propagate}(@builtin(global_invocation_id) id:vec3u){
 if(!all(id<vec3u(mip.resolution))){return;}
 let c=vec3i(id);
 var centre=previousDistance(c,vec3i(0));
 let v=vec3f(
  min(previousDistance(c,vec3i(-1,0,0)),previousDistance(c,vec3i(1,0,0))),
  min(previousDistance(c,vec3i(0,-1,0)),previousDistance(c,vec3i(0,1,0))),
  min(previousDistance(c,vec3i(0,0,-1)),previousDistance(c,vec3i(0,0,1))));
 let low=min(v.x,min(v.y,v.z));
 let high=max(v.x,max(v.y,v.z));
 let middle=select(select(v.z,v.y,v.y!=low&&v.y!=high),v.x,v.x!=low&&v.x!=high);
 centre=min(centre,low+STEP);
 centre=min(centre,eikonal2(low,middle));
 centre=min(centre,eikonal3(low,middle,high));
 textureStore(next,c+vec3i(0,0,i32(mip.offsetZ)),vec4f(f32(unorm8Byte(saturate(centre)))/255.0,0.0,0.0,0.0));
}`,
  [ATLAS_FETCH_WGSL, unorm8Byte],
)

/** `fillPageTable`: every texel of a page table made all ones, no page. */
export const FILL_SHADER = `@group(0) @binding(0) var table:texture_storage_3d<r32uint,write>;
@compute @workgroup_size(4,4,4) fn ${MIP_ENTRIES.fill}(@builtin(global_invocation_id) id:vec3u){
 if(all(id<textureDimensions(table))){textureStore(table,vec3i(id),vec4u(0xFFFFFFFFu));}
}`
