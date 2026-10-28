import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { HAIR_FLAG } from './materialMath.ts'
import { HAIR_RIBBON_WGSL, HAIR_VIEW_WGSL } from './ribbonWgsl.ts'
import { HAIR_VOXEL_MAX_RASTER_COUNT, HAIR_VOXEL_PAGE_GROUP } from './voxelMath.ts'
import { VOXEL_COMMON_WGSL, VOXEL_PARAMS_WGSL } from './voxelWgsl.ts'

/** The coverage a voxel adds is a whole number: a strand's share of the voxel times this, so that the
 *  voxels are summed by an atomic add (the voxel's low 24 bits hold the sum, `VOXEL_HAIR_MASK`). */
export const HAIR_VOXEL_FIX_POINT_SCALE = 1000
/** The bits of a voxel: the sum of the coverage in the low 24, the opaque surface's mark in the next 7
 *  and, in the last, whether the voxel does not cast a hair shadow. */
export const HAIR_VOXEL_BITS = {
  hairMask: 0x00ffffff,
  opaqueMask: 0x7f000000,
  opaqueAdd: 0x7f000000,
  noShadow: 0x80000000,
} as const
/** The density the strands of a group give a voxel, as a groom without a setting of its own has it
 *  (the groom's shadow density), and the scale of the coverage of its level of detail. */
const HAIR_SHADOW_DENSITY = 1
const HAIR_COVERAGE_SCALE = 1

/**
 * A MACRO GROUP'S NODE (`ADD_NODE_WGSL`) as the passes that read the volume unpack it: its box, its
 * resolution in pages and offset in the page index, its voxel's width and the volume's resolution in
 * voxels. Reads `nodes` (its host declares it), `params`.
 */
export const VOXEL_NODE_WGSL = wgslBlock(
  'HAIR_VOXEL_NODE_WGSL',
  [VOXEL_COMMON_WGSL],
  `struct VoxelNode{lo:vec3f,hi:vec3f,pages:vec3u,voxels:vec3u,offset:u32,size:f32}
fn nodeOf(owner:u32)->VoxelNode{
 let at=owner*8u;
 let packed=nodes[at+3u];
 let pages=vec3u(packed&0xFFu,(packed>>8u)&0xFFu,(packed>>16u)&0xFFu);
 return VoxelNode(
  vec3f(bitcast<f32>(nodes[at]),bitcast<f32>(nodes[at+1u]),bitcast<f32>(nodes[at+2u])),
  vec3f(bitcast<f32>(nodes[at+4u]),bitcast<f32>(nodes[at+5u]),bitcast<f32>(nodes[at+6u])),
  pages,pages*params.pageResolution,nodes[at+7u]&0x1FFFFFu,unpackVoxelSize(nodes[at+7u]>>21u));
}
// The word of a voxel of a page's first level: the pages follow each other, a page's voxels in the order of
// their coordinates (x first).
fn voxelAt(page:u32,offset:vec3u)->u32{
 let n=params.pageResolution;
 return page*params.pageStride+offset.x+offset.y*n+offset.z*n*n;
}`,
)

/**
 * THE VOXELIZATION OF THE STRANDS: a thread a segment of the instance bound in group 0 (the macro group
 * is the instance's), each stepping along the segment by a third less than a voxel and adding, to each
 * voxel it enters, the share of the voxel the strand covers there (its radius over the larger of its radius
 * and half a voxel, interpolated along the segment), times the groom's shadow density: once a voxel for a
 * run of steps. A step whose page the volume has none for adds nothing. The segment that ends a strand is
 * skipped. The voxels are summed with an atomic add of the volume's buffer; a group traced as geometry
 * marks its voxels as casting no hair shadow.
 */
export const VOXEL_RASTER_WGSL = wgslProgram(
  `@group(1) @binding(1) var<storage,read> nodes:array<u32>;
@group(1) @binding(2) var<storage,read> pageIndex:array<u32>;
@group(1) @binding(3) var<storage,read_write> voxels:array<atomic<u32>>;
@group(1) @binding(4) var<uniform> params:VoxelParams;
const STEP_SCALE=1.5;
const MAX_STEPS=${HAIR_VOXEL_MAX_RASTER_COUNT}.0;
const FIX_POINT=${HAIR_VOXEL_FIX_POINT_SCALE}.0;
const DENSITY=${HAIR_SHADOW_DENSITY}.0;
const COVERAGE_SCALE=${HAIR_COVERAGE_SCALE}.0;
@compute @workgroup_size(WORKGROUP_THREADS) fn hairVoxelRaster(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let first=flatIndex(id,groups,WORKGROUP_THREADS);
 if(first+1u>=inst.ids.y){return;}
 if((points[first].y>>30u)==KIND_END){return;}
 let node=nodeOf(inst.flags.w);
 // A group with no page index (it voxelizes nothing, or the index had no room) has no voxel.
 if(any(node.pages==vec3u(0u))){return;}
 let a=spineAt(first);
 let b=spineAt(first+1u);
 let coverageA=a.radius/max(a.radius,0.5*node.size);
 let coverageB=b.radius/max(b.radius,0.5*node.size);
 let stepSize=node.size/STEP_SCALE;
 let segment=b.position-a.position;
 let extent=length(segment);
 if(!(extent>0.0)){return;}
 let stride=segment/extent*stepSize;
 let steps=f32(min(u32(ceil(extent/stepSize)),u32(MAX_STEPS)));
 let virtualResolution=vec3f(node.voxels-vec3u(1u));
 var held=vec3i(-1);
 var valid=false;
 var page=0u;
 var previous=0xFFFFFFFFu;
 for(var at=0.0;at<steps;at+=1.0){
  let u=(at+0.5)/steps;
  let hit=a.position+at*stride;
  let volume=vec3u(clamp((hit-node.lo)/node.size,vec3f(0.0),virtualResolution));
  let pageCoord=volume/params.pageResolution;
  if(any(vec3i(pageCoord)!=held)){
   held=vec3i(pageCoord);
   page=pageIndex[coordToIndex(pageCoord,node.pages,node.offset)];
   valid=page!=INVALID_PAGE;
  }
  if(!valid){continue;}
  let word=voxelAt(page,volume-pageCoord*params.pageResolution);
  if(word!=previous){
   let coverage=mix(coverageA,coverageB,u);
   atomicAdd(&voxels[word],u32(coverage*FIX_POINT*DENSITY*COVERAGE_SCALE));
   if((inst.flags.x&${HAIR_FLAG.rayTracedGeometry}u)!=0u){atomicOr(&voxels[word],${HAIR_VOXEL_BITS.noShadow}u);}
  }
  previous=word;
 }
}`,
  [HAIR_RIBBON_WGSL, VOXEL_COMMON_WGSL, VOXEL_NODE_WGSL, WORKGROUP_THREADS_WGSL, FLAT_INDEX_WGSL],
)

/**
 * THE OPAQUE SURFACE IN THE VOXELS: for each page a macro group has allocated (the dispatch of its pages,
 * `which` its number), each voxel is carried to the screen; one that lies behind the opaque surface by
 * no more than `markCount` voxels, in front of the volume's far side only, takes the opaque mark, so that
 * the voxels act as an occluder of the light the surface reflects. The surface's depth is taken
 * `biasCount` voxels in front. Voxels off the screen, or whose surface lies outside the volume, are left.
 */
export const VOXEL_INJECT_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> nodes:array<u32>;
@group(0) @binding(2) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(3) var<storage,read> pageIndexCoord:array<u32>;
@group(0) @binding(4) var<storage,read> counter:array<u32>;
@group(0) @binding(5) var<storage,read_write> voxels:array<atomic<u32>>;
@group(0) @binding(6) var sceneDepth:texture_depth_2d;
@group(0) @binding(7) var<uniform> view:HairView;
@group(0) @binding(8) var<uniform> which:vec4u;
@group(0) @binding(9) var<uniform> inject:vec4u;
@compute @workgroup_size(${HAIR_VOXEL_PAGE_GROUP[0]},1,${HAIR_VOXEL_PAGE_GROUP[1]}) fn hairVoxelInject(@builtin(global_invocation_id) id:vec3u){
 let perPage=params.pageResolution*params.pageResolution*params.pageResolution;
 if(id.z>=counter[1u+which.x]||id.x>=perPage){return;}
 var offset=indexToCoord(id.x,vec3u(params.pageResolution));
 offset.y=offset.y%params.pageResolution;
 offset.z=offset.z%params.pageResolution;
 let node=nodeOf(which.x);
 let packed=pageIndexCoord[node.offset+id.z];
 let coord=vec3u(packed&0xFFu,(packed>>8u)&0xFFu,(packed>>16u)&0xFFu);
 if((packed>>24u)==INVALID_MACRO||coordToIndex(coord,node.pages,node.offset)>=params.totalPageIndexCount){return;}
 let page=pageIndex[coordToIndex(coord,node.pages,node.offset)];
 if(page==INVALID_PAGE){return;}
 let position=vec3f(coord*params.pageResolution+offset)*node.size+node.lo;
 let clip=view.viewProj*vec4f(position,1.0);
 if(!(clip.w>0.0)){return;}
 let ndc=clip.xyz/clip.w;
 let uv=vec2f(0.5*(ndc.x+1.0),1.0-0.5*(ndc.y+1.0));
 if(any(uv<vec2f(0.0))||any(uv>=vec2f(1.0))){return;}
 let forward=view.forward.xyz;
 let voxelDepth=dot(position,forward)-f32(inject.x)*node.size;
 let pixel=min(vec2u(uv*view.size),vec2u(view.size)-vec2u(1u));
 let device=textureLoad(sceneDepth,vec2i(pixel),0);
 let hit=view.inverseViewProj*vec4f(ndc.x,ndc.y,device,1.0);
 let surface=hit.xyz/hit.w;
 if(any(surface<node.lo)||any(surface>=node.hi)){return;}
 let closest=dot(surface,forward);
 if(closest<voxelDepth&&abs(closest-voxelDepth)<f32(inject.y)*node.size){
  atomicOr(&voxels[voxelAt(page,offset)],${HAIR_VOXEL_BITS.opaqueAdd}u);
 }
}`,
  [VOXEL_PARAMS_WGSL, VOXEL_NODE_WGSL, HAIR_VIEW_WGSL],
)
