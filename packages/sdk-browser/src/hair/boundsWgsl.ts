import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'

/** The steps a metre of a bound is cut into when it is stored as a whole number: a hundredth of a
 *  millimetre, a thousand to a centimetre. */
export const HAIR_AABB_PRECISION_SCALE = 100_000
/** How near a macro group may be taken to the camera when its voxel is sized, in metres. */
const NEAR_CLIP = 0.00001
/** The threads that reduce the bounds of a macro group's instances. */
const MACRO_THREADS = 32

const AABB_WGSL = wgslBlock(
  'HAIR_AABB_WGSL',
  [],
  `struct Aabb{lo:vec3f,hi:vec3f}
const PRECISION=${HAIR_AABB_PRECISION_SCALE}.0;`,
)

/**
 * THE BOUNDS OF EACH INSTANCE, as whole numbers: the box of its strands in the camera's translated
 * world. A bound is six integers, its metres times `HAIR_AABB_PRECISION_SCALE` cut toward zero.
 */
export const GROUP_BOUNDS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read> bounds:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> groupAabb:array<i32>;
@compute @workgroup_size(WORKGROUP_THREADS) fn hairGroupBounds(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(id,groups,WORKGROUP_THREADS);
 if(at*2u+1u>=arrayLength(&bounds)){return;}
 let lo=vec3i(bounds[at*2u].xyz*PRECISION);
 let hi=vec3i(bounds[at*2u+1u].xyz*PRECISION);
 for(var axis=0u;axis<3u;axis++){
  groupAabb[at*6u+axis]=lo[axis];
  groupAabb[at*6u+3u+axis]=hi[axis];
 }
}`,
  [AABB_WGSL, WORKGROUP_THREADS_WGSL, FLAT_INDEX_WGSL],
)

/**
 * THE BOUNDS OF A MACRO GROUP, one workgroup each: the union of the bounds of its instances, written
 * as six integers; and the size of its voxel, so that a voxel spans `numPixelPerVoxel` pixels where the
 * group is nearest to the camera (a perspective view's pixel grows with the distance, an orthographic
 * view's does not), and that the group spans a page of voxels at least, never below
 * `minVoxelSize`. The box is carried into the camera's frame by its eight corners; the camera looks
 * down −z, so the nearest distance is minus the greatest z.
 */
export const MACRO_BOUNDS_WGSL = wgslProgram(
  `const GROUP_SIZE=${MACRO_THREADS}u;
const NEAR_CLIP=${NEAR_CLIP};
struct Camera{toCamera:mat4x4f,pixelSizeAtDepth1:f32,numPixelPerVoxel:f32,pageResolution:u32,minVoxelSize:f32,perspective:u32}
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read> entries:array<vec4u>;
@group(0) @binding(2) var<storage,read> registered:array<u32>;
@group(0) @binding(3) var<storage,read> groupAabb:array<i32>;
@group(0) @binding(4) var<storage,read_write> macroAabb:array<i32>;
@group(0) @binding(5) var<storage,read_write> macroVoxelSize:array<f32>;
var<workgroup> chosen:vec4u;
var<workgroup> lows:array<vec3f,GROUP_SIZE>;
var<workgroup> highs:array<vec3f,GROUP_SIZE>;
fn readAabb(index:u32)->Aabb{
 let at=index*6u;
 let lo=vec3f(f32(groupAabb[at]),f32(groupAabb[at+1u]),f32(groupAabb[at+2u]));
 let hi=vec3f(f32(groupAabb[at+3u]),f32(groupAabb[at+4u]),f32(groupAabb[at+5u]));
 return Aabb(lo/PRECISION,hi/PRECISION);
}
fn unionAabb(a:Aabb,b:Aabb)->Aabb{return Aabb(min(a.lo,b.lo),max(a.hi,b.hi));}
fn inCamera(b:Aabb)->Aabb{
 var lo=vec3f(3.4e38);
 var hi=vec3f(-3.4e38);
 for(var corner=0u;corner<8u;corner++){
  let at=vec3f(select(b.lo.x,b.hi.x,(corner&1u)!=0u),select(b.lo.y,b.hi.y,(corner&2u)!=0u),select(b.lo.z,b.hi.z,(corner&4u)!=0u));
  let seen=(camera.toCamera*vec4f(at,1.0)).xyz;
  lo=min(lo,seen);
  hi=max(hi,seen);
 }
 return Aabb(lo,hi);
}
fn writeAabb(rank:u32,b:Aabb){
 let lo=vec3i(b.lo*PRECISION);
 let hi=vec3i(b.hi*PRECISION);
 for(var axis=0u;axis<3u;axis++){
  macroAabb[rank*6u+axis]=lo[axis];
  macroAabb[rank*6u+3u+axis]=hi[axis];
 }
}
@compute @workgroup_size(GROUP_SIZE) fn hairMacroBounds(@builtin(workgroup_id) workgroup:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){chosen=entries[workgroup.x];}
 let entry=workgroupUniformLoad(&chosen);
 let turns=(entry.z+GROUP_SIZE-1u)/GROUP_SIZE;
 for(var turn=0u;turn<turns;turn++){
  let listed=turn*GROUP_SIZE+lane;
  if(listed<entry.z){
   let bound=readAabb(registered[entry.y+listed]);
   if(turn==0u){lows[lane]=bound.lo;highs[lane]=bound.hi;}
   else{lows[lane]=min(lows[lane],bound.lo);highs[lane]=max(highs[lane],bound.hi);}
  }
 }
 workgroupBarrier();
 if(lane==0u){
  var bound=Aabb(vec3f(2147483647.0),vec3f(-2147483647.0));
  for(var k=0u;k<min(GROUP_SIZE,entry.z);k++){bound=unionAabb(bound,Aabb(lows[k],highs[k]));}
  let seen=inCamera(bound);
  let depth=select(1.0,max(-seen.hi.z,NEAR_CLIP),camera.perspective!=0u);
  var voxelWorldSize=camera.pixelSizeAtDepth1*depth*camera.numPixelPerVoxel;
  writeAabb(entry.x,bound);
  let extent=bound.hi-bound.lo;
  let maxExtent=max(extent.x,max(extent.y,extent.z));
  if(maxExtent/voxelWorldSize<f32(camera.pageResolution)){voxelWorldSize=maxExtent/f32(camera.pageResolution);}
  macroVoxelSize[entry.x]=max(camera.minVoxelSize,voxelWorldSize);
 }
}`,
  [AABB_WGSL],
)
