import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { CONE_TILES_PER_GROUP, CULLED_TILE_DATA_STRIDE } from './coneObjectsWgsl.ts'
import { TILE_SIZE } from './cones.ts'
import { DFAO_GRID_WGSL } from './gridWgsl.ts'
import { DFAO_BINDING as B } from './layout.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'

/** The threads of a group of the meshes' culling to the view, and of the start offsets. */
export const CULL_GROUP = 64

/**
 * THE MESHES CULLED TO THE VIEW (`dfaoCullObjects`), a thread a mesh of the scene: those whose bounding sphere is
 * nearer than the farthest pixel lit plus its radius and reaches the view frustum within the occlusion distance, and
 * that are drawn at this distance (the squared distance over `drawDistance2.x` if it is above 0.0001, under
 * `.y` likewise), are listed, a group at a time (one atomic add for the group's share of the list). The draw's
 * arguments (`objectArgs`: the index count of the bounding sphere, the meshes listed, zeros) are cleared to zero by
 * the host before the pass. Under an orthographic projection the distance is the length over the view's forward component (squared), so an object off the axis is farther.
 */
export const DFAO_CULL_OBJECTS_WGSL = wgslProgram(
  `@group(0) @binding(${B.culledObjects}) var<storage,read_write> culledObjects:array<u32>;
@group(0) @binding(${B.objectArgs}) var<storage,read_write> objectArgs:array<atomic<u32>>;
var<workgroup> groupCount:atomic<u32>;
var<workgroup> groupBase:u32;
var<workgroup> groupObjects:array<u32,${CULL_GROUP}>;
fn dfaoDistanceSquared(v:vec3f)->f32{
 if(dfao.depth.z>0.5){return dot(v,v);}
 let along=dot(v,dfao.viewToWorld[2].xyz);
 if(along==0.0){return 3.0e38;}
 let d=dot(v,v)/along;
 return d*d;
}
fn dfaoInFrustum(center:vec3f,radius:f32)->bool{
 for(var plane=0u;plane<dfao.counts.x;plane++){
  let p=dfao.planes[plane];
  if(dot(p.xyz,center)-p.w>radius){return false;}
 }
 return true;
}
@compute @workgroup_size(${CULL_GROUP})
fn dfaoCullObjects(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(id.x==0u){atomicStore(&objectArgs[0],dfao.counts.z);}
 if(lane==0u){atomicStore(&groupCount,0u);}
 workgroupBarrier();
 if(id.x<dfao.counts.y){
  let bounds=loadDfObjectBounds(id.x);
  let sphere=bounds.sphereRadius;
  let center=bounds.center.hi+bounds.center.lo;
  let distanceSquared=dfaoDistanceSquared(dfao.viewToWorld[3].xyz-center);
  let farthest=dfao.distances.w+sphere;
  if(distanceSquared<farthest*farthest&&dfaoInFrustum(center,sphere+dfao.distances.x)){
   let range=loadDfObjectData(id.x).drawDistance2;
   if((range.x<0.0001||distanceSquared>range.x)&&(range.y<0.0001||distanceSquared<range.y)){
    groupObjects[atomicAdd(&groupCount,1u)]=id.x;
   }
  }
 }
 workgroupBarrier();
 let count=atomicLoad(&groupCount);
 if(lane==0u){groupBase=atomicAdd(&objectArgs[1],count);}
 workgroupBarrier();
 if(lane<count){culledObjects[groupBase+lane]=groupObjects[lane];}
}`,
  [DFAO_COMMON_WGSL, meshFieldWgsl(0, B.objects)],
)

/**
 * THE TILES' CONES (`dfaoTileCones`), a group a tile of the grid: the bounding cone of the tile's rays — its axis,
 * the cosine of its half angle — and the two ranges of distance along the axis its surfaces lie in, that of the
 * nearer half of the depths (`.xy`) and of the farther (`.zw`), found by the group's atomic minimum and maximum
 * of the cells' depths below the farthest pixel lit (a depth's bits order as the numbers do). The axis is of the
 * rays through the tile's four corners at unit forward, the distances are along the axis, the near plane's added; a tile
 * with no cell under the farthest depth holds the axis `(0, 0, 0, 1)` and no range. The grid's cells past the
 * view hold a depth of nothing, and count as a surface at it.
 */
export const DFAO_TILE_CONES_WGSL = wgslProgram(
  `@group(0) @binding(${B.tileAxis}) var<storage,read_write> tileAxis:array<vec4f>;
@group(0) @binding(${B.tileRanges}) var<storage,read_write> tileRanges:array<vec4f>;
var<workgroup> tileMin:atomic<u32>;
var<workgroup> tileMax:atomic<u32>;
var<workgroup> tileMin2:atomic<u32>;
var<workgroup> tileMax2:atomic<u32>;
fn dfaoTileCorner(group:vec2u,corner:vec2u,size:vec2f)->vec3f{
 let at=(vec2f(group+corner)/vec2f(dfao.cones.zw))*2.0;
 return normalize(vec3f(at.x*size.x-size.x,size.y-at.y*size.y,1.0));
}
@compute @workgroup_size(${TILE_SIZE},${TILE_SIZE})
fn dfaoTileCones(@builtin(workgroup_id) group:vec3u,@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 let depth=abs(dfaoGrid(vec2i(id.xy)).w);
 let limit=dfao.distances.w;
 if(lane==0u){
  atomicStore(&tileMin,0x7F7FFFFFu);
  atomicStore(&tileMax,0u);
  atomicStore(&tileMin2,0x7F7FFFFFu);
  atomicStore(&tileMax2,0u);
 }
 workgroupBarrier();
 if(depth<limit){
  atomicMin(&tileMin,bitcast<u32>(depth));
  atomicMax(&tileMax,bitcast<u32>(depth));
 }
 workgroupBarrier();
 let middle=0.5*(bitcast<f32>(atomicLoad(&tileMin))+bitcast<f32>(atomicLoad(&tileMax)));
 if(depth>=middle&&depth<limit){atomicMin(&tileMin2,bitcast<u32>(depth));}
 if(depth<=middle){atomicMax(&tileMax2,bitcast<u32>(depth));}
 workgroupBarrier();
 if(lane!=0u){return;}
 let nearest=bitcast<f32>(atomicLoad(&tileMin));
 let farthest=bitcast<f32>(atomicLoad(&tileMax));
 let nearest2=bitcast<f32>(atomicLoad(&tileMin2));
 let farthest2=bitcast<f32>(atomicLoad(&tileMax2));
 let size=vec2f(1.0/dfao.lens.x,1.0/dfao.lens.y);
 let c00=dfaoTileCorner(group.xy,vec2u(0u,0u),size);
 let c10=dfaoTileCorner(group.xy,vec2u(1u,0u),size);
 let c01=dfaoTileCorner(group.xy,vec2u(0u,1u),size);
 let c11=dfaoTileCorner(group.xy,vec2u(1u,1u),size);
 let axis=normalize(c00+c10+c01+c11);
 let cosine=dot(axis,c00);
 let toNear=length(axis/axis.z*dfao.lens.z);
 let along=1.0/axis.z;
 let ranges=vec4f(along*nearest+toNear,along*farthest2+toNear,along*nearest2+toNear,along*farthest+toNear);
 let tile=group.y*dfao.cones.z+group.x;
 let empty=atomicLoad(&tileMin)>atomicLoad(&tileMax);
 tileAxis[tile]=select(vec4f(axis,cosine),vec4f(0.0,0.0,0.0,1.0),empty);
 tileRanges[tile]=select(ranges,vec4f(0.0),empty);
}`,
  [DFAO_COMMON_WGSL, DFAO_GRID_WGSL],
)

/**
 * THE START OFFSETS OF THE TILE LISTS (`dfaoStartOffsets`), a thread a culled mesh: its tiles, counted by the
 * scatter's first pass, rounded up to whole groups of `CONE_TILES_PER_GROUP` tiles, take a run of the list, whose
 * start is the sum of the groups before (one atomic add on the cone trace's group count, which the draw is
 * dispatched with); the tiles the group leaves empty are filled with `DFAO_NO_TILE`, so the trace skips them. The
 * first thread sets the other two counts of the dispatch to one.
 */
export const DFAO_START_OFFSETS_WGSL = wgslProgram(
  `@group(0) @binding(${B.objectArgs}) var<storage,read> culledArgs:array<u32>;
@group(0) @binding(${B.tileCounts}) var<storage,read> tileCounts:array<u32>;
@group(0) @binding(${B.tileOffsets}) var<storage,read_write> tileOffsets:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read_write> tileData:array<u32>;
@group(0) @binding(${B.tileArgs}) var<storage,read_write> tileArgs:array<atomic<u32>>;
@compute @workgroup_size(${CULL_GROUP})
fn dfaoStartOffsets(@builtin(global_invocation_id) id:vec3u){
 if(id.x<culledArgs[1]){
  let tiles=tileCounts[id.x];
  let groups=(tiles+${CONE_TILES_PER_GROUP - 1}u)/${CONE_TILES_PER_GROUP}u;
  let start=atomicAdd(&tileArgs[0],groups)*${CONE_TILES_PER_GROUP}u;
  tileOffsets[id.x]=start;
  for(var padding=tiles;padding<groups*${CONE_TILES_PER_GROUP}u;padding++){
   tileData[(start+padding)*${CULLED_TILE_DATA_STRIDE}u]=DFAO_NO_TILE;
   tileData[(start+padding)*${CULLED_TILE_DATA_STRIDE}u+1u]=id.x;
  }
 }
 if(id.x==0u){
  atomicStore(&tileArgs[1],1u);
  atomicStore(&tileArgs[2],1u);
 }
}`,
  [DFAO_COMMON_WGSL],
)
