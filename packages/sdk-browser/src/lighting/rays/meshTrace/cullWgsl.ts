import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import {
  deviceDepthOfView,
  unprojectPoint,
  viewDepthCmOfDevice,
} from '../../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { OBJECT_DATA_STRIDE } from '../../distanceField/layout.ts'
import { meshFieldWgsl } from '../../distanceField/meshFieldWgsl.ts'
import {
  DF_CULL_HELPERS_WGSL,
  dfCullFrustumWgsl,
  dfCullGroupWgsl,
} from '../../distanceField/objectCullWgsl.ts'
import { meshGridCommonWgsl } from './commonWgsl.ts'
import {
  CELL_WORDS,
  MESH_GRID_BINDING as B,
  MESH_GRID_GROUP,
  SCATTER_ENTRY_WORDS,
} from './layout.ts'

const COMMON = meshGridCommonWgsl(0, B.params)

/**
 * THE MESHES CULLED TO THE VIEW (`msdfCullObjects`), a thread a mesh of the scene: those that are drawn or still
 * light the scene while hidden, nearer than the farthest distance traced plus their radius, whose bounding sphere is larger
 * than the radius threshold or that emit light, that reach the view frustum within the trace distance, and that are drawn at
 * this distance (the squared distance over `drawDistance2.x` if it is above 0.0001, under `.y` likewise), are
 * listed, a group at a time (one atomic add for the group's share of the list). The draw's arguments (`objectArgs`: the
 * index count of the bounding sphere, the meshes listed, zeros) are cleared to zero by the host before the pass. Under an orthographic
 * projection the distance is the length over the view's forward component (squared), so a mesh off the axis is farther (`dfCullDistanceSquared`).
 */
export const MESH_GRID_CULL_WGSL = wgslProgram(
  `@group(0) @binding(${B.culledObjects}) var<storage,read_write> culledObjects:array<u32>;
@group(0) @binding(${B.objectArgs}) var<storage,read_write> objectArgs:array<atomic<u32>>;
fn dfCullKeeps(index:u32,bounds:DfObjectBounds,centre:vec3f)->bool{
 let sphere=bounds.sphereRadius;
 let forward=vec3f(msdf.worldToView[0][2],msdf.worldToView[1][2],msdf.worldToView[2][2]);
 let distanceSquared=dfCullDistanceSquared(msdf.eye.xyz-centre,msdf.depth.z>0.5,forward);
 let reach=msdf.distances.x+sphere;
 let emissive=(bounds.flags&MSDF_EMISSIVE)!=0u;
 return (bounds.flags&(MSDF_VISIBLE|MSDF_HIDDEN_AFFECTS))!=0u
  &&distanceSquared<reach*reach
  &&(sphere>msdf.distances.z||emissive)
  &&dfCullInFrustum(centre,sphere+msdf.distances.y)
  &&dfCullDrawn(loadDfObjectData(index).drawDistance2,distanceSquared);
}`,
  [
    COMMON,
    meshFieldWgsl(0, B.objects),
    DF_CULL_HELPERS_WGSL,
    dfCullFrustumWgsl('msdf.planes', 'msdf.counts.x'),
    dfCullGroupWgsl('msdfCullObjects', MESH_GRID_GROUP, 'msdf.counts.y', 'msdf.counts.z'),
  ],
)

/**
 * THE MESHES SCATTERED TO THE GRID'S CELLS (`msdfScatterVs`, `msdfScatterFs`): the bounding sphere of every culled mesh is
 * drawn — its back faces, for the eye may be inside —, enlarged by the trace distance and by the factor that puts the edges of
 * the coarse sphere on the true one (`distances.w`, over 0.7), into a target with a pixel a cell of the grid's
 * face; each pixel is a column of cells the sphere covers.
 *
 * For each, the mesh's world box grown by the trace distance, in the eye's frame, is cut by the planes of the cell's
 * frustum (the cell's four sides from the projection, the slice's two from its depths): it must lie in front of none of
 * them. With slices, the slices run from the depth that the mesh's near side and the nearest depth of the pixels of the
 * column (the pyramid's nearest bound of the cell, read at the level whose cell is the grid's, in pixels) leave, to the one its far
 * side and the farthest depth of the column (the pyramid's farthest bound of the occluders, the reference's furthest pyramid)
 * leave. Then the mesh's field must come within the radius of the sphere that bounds the cell (its centre and its
 * corners' farthest, grown by the trace distance) of the cell's centre. A cell it reaches counts the mesh in its
 * `cells` word and takes the next place of the entries list: the mesh and the cell, to be compacted by their cell.
 */
export const MESH_GRID_SCATTER_WGSL = wgslProgram(
  `@group(0) @binding(${B.culledObjects}) var<storage,read> culledObjects:array<u32>;
@group(0) @binding(${B.scatterCount}) var<storage,read_write> scatterCount:array<atomic<u32>>;
@group(0) @binding(${B.scatterEntries}) var<storage,read_write> scatterEntries:array<u32>;
@group(0) @binding(${B.cells}) var<storage,read_write> cells:array<atomic<u32>>;
struct ScatterVertex{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) center:vec4f,
 @location(1) @interpolate(flat) object:u32,
}
@vertex
fn msdfScatterVs(@location(0) corner:vec4f,@builtin(instance_index) instance:u32)->ScatterVertex{
 let object=culledObjects[instance];
 let bounds=loadDfObjectBounds(object);
 let center=bounds.center.hi+bounds.center.lo;
 let radius=(bounds.sphereRadius+msdf.distances.y)*msdf.distances.w/0.7;
 return ScatterVertex(msdf.viewProjection*vec4f(corner.xyz*radius+center,1.0),vec4f(center,bounds.sphereRadius),object);
}
/** The world extent of the mesh's oriented box: the half-extent of its volume carried by the absolute volume-to-world rows. */
fn msdfWorldExtent(object:u32,volumeExtent:vec3f)->vec3f{
 let at=object*${OBJECT_DATA_STRIDE}u;
 return vec3f(
  dot(abs(bitcast<vec4f>(sceneObjectData[at+6u]).xyz),volumeExtent),
  dot(abs(bitcast<vec4f>(sceneObjectData[at+7u]).xyz),volumeExtent),
  dot(abs(bitcast<vec4f>(sceneObjectData[at+8u]).xyz),volumeExtent));
}
fn msdfCellWorld(coord:vec3u,offset:vec3f)->vec3f{
 let uv=(vec2f(coord.xy)+offset.xy)/vec2f(msdf.grid.xy);
 let ndc=(uv*2.0-vec2f(1.0))*vec2f(1.0,-1.0);
 let depth=msdfSliceDepth(f32(coord.z)+offset.z);
 return unprojectPoint(msdf.unprojectToWorld,vec3f(ndc,deviceDepthOfView(msdf.depth,depth*0.01)));
}
/** The slices the column of the pixel is bounded to: from the nearest depth to the farthest the object and the pixels leave. */
fn msdfSliceSpan(pixel:vec2u,viewZ:f32,reach:f32)->vec2u{
 if((msdf.counts.w&MSDF_SLICES)==0u){return vec2u(0u);}
 var minDepth=viewZ-reach;
 var maxDepth=viewZ+reach;
 let level=min(max(msdf.limits.z,1u),u32(hizLevelCount()-1));
 let cell=vec2i((pixel<<vec2u(msdf.grid.w))>>vec2u(level));
 minDepth=max(minDepth,viewDepthCmOfDevice(msdf.depth,hizCellNearest(cell,i32(level))));
 maxDepth=min(maxDepth,viewDepthCmOfDevice(msdf.depth,hizCellCullFarthest(cell,i32(level))));
 return vec2u(msdfSliceOf(minDepth),msdfSliceOf(maxDepth));
}
@fragment
fn msdfScatterFs(v:ScatterVertex)->@location(0) vec4f{
 let pixel=vec2u(v.position.xy);
 let data=loadDfObjectData(v.object);
 let objectView=(msdf.worldToView*vec4f(v.center.xyz,1.0)).xyz;
 let toView=mat3x3f(abs(msdf.worldToView[0].xyz),abs(msdf.worldToView[1].xyz),abs(msdf.worldToView[2].xyz));
 let extent=toView*msdfWorldExtent(v.object,data.extent)+vec3f(msdf.distances.y);
 let tileScale=msdf.view.xy/f32(2u<<msdf.grid.w);
 let tileBias=tileScale-vec2f(pixel)-vec2f(0.5);
 var planes:array<vec4f,6>;
 let c1=vec4f(msdf.lens.x*tileScale.x,0.0,msdf.lens.y*tileScale.x+tileBias.x,0.0);
 let c2=vec4f(0.0,-msdf.lens.z*tileScale.y,msdf.lens.w*tileScale.y+tileBias.y,0.0);
 let c4=vec4f(0.0,0.0,1.0,0.0);
 planes[0]=c4-c1;
 planes[1]=c4+c1;
 planes[2]=c4-c2;
 planes[3]=c4+c2;
 for(var i=0u;i<4u;i++){planes[i]=planes[i]/length(planes[i].xyz);}
 let span=msdfSliceSpan(pixel,objectView.z,extent.z);
 for(var slice=span.x;slice<=span.y;slice++){
  let coord=vec3u(pixel,slice);
  planes[4]=vec4f(0.0,0.0,1.0,-msdfSliceDepth(f32(slice)));
  planes[5]=vec4f(0.0,0.0,-1.0,msdfSliceDepth(f32(slice)+1.0));
  var reaches=true;
  for(var i=0u;i<6u;i++){
   let toPlane=dot(planes[i],vec4f(objectView,1.0));
   reaches=reaches&&toPlane>=-dot(extent,abs(planes[i].xyz));
  }
  if(reaches){
   let centre=msdfCellWorld(coord,vec3f(0.5));
   var corner=length(msdfCellWorld(coord,vec3f(1.0))-centre);
   corner=max(length(msdfCellWorld(coord,vec3f(0.0,0.0,1.0))-centre),corner);
   let radius=corner+msdf.distances.y;
   reaches=distanceToNearestSurfaceForObject(data,DfVec3(centre,vec3f(0.0)),radius)<radius;
  }
  if(reaches){
   let cell=(slice*msdf.grid.y+pixel.y)*msdf.grid.x+pixel.x;
   atomicAdd(&cells[cell*${CELL_WORDS}u],1u);
   let entry=atomicAdd(&scatterCount[0],1u);
   if(entry<msdf.limits.x){
    scatterEntries[entry*${SCATTER_ENTRY_WORDS}u]=v.object;
    scatterEntries[entry*${SCATTER_ENTRY_WORDS}u+1u]=cell;
   }
  }
 }
 return vec4f(0.0);
}`,
  [
    COMMON,
    meshFieldWgsl(0, B.objects),
    hizDepthWgsl(0, B.depth),
    unprojectPoint,
    deviceDepthOfView,
    viewDepthCmOfDevice,
  ],
)

/**
 * THE RUNS OF THE CELLS (`msdfStartOffsets`), a thread a cell: the meshes the scatter counted in it take a run of the
 * compacted list, whose start is the sum of the runs before (one atomic add on the allocator), written in the cell's second
 * word; the count is reset to zero for the compaction to count again. The first thread sets the compaction's dispatch: the
 * entries scattered, over the group, then ones.
 */
export const MESH_GRID_START_OFFSETS_WGSL = wgslProgram(
  `@group(0) @binding(${B.scatterCount}) var<storage,read> scatterCount:array<u32>;
@group(0) @binding(${B.cells}) var<storage,read_write> cells:array<atomic<u32>>;
@group(0) @binding(${B.allocator}) var<storage,read_write> allocator:array<atomic<u32>>;
@group(0) @binding(${B.compactArgs}) var<storage,read_write> compactArgs:array<u32>;
@compute @workgroup_size(${MESH_GRID_GROUP})
fn msdfStartOffsets(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u){
  compactArgs[0]=(scatterCount[0]+${MESH_GRID_GROUP - 1}u)/${MESH_GRID_GROUP}u;
  compactArgs[1]=1u;
  compactArgs[2]=1u;
 }
 if(id.x<msdf.limits.y){
  let count=atomicExchange(&cells[id.x*${CELL_WORDS}u],0u);
  atomicStore(&cells[id.x*${CELL_WORDS}u+1u],atomicAdd(&allocator[0],count));
 }
}`,
  [COMMON],
)

/**
 * THE MESHES COMPACTED BY THEIR CELL (`msdfCompact`), a thread an entry the scatter kept: the mesh takes the next place of its cell's run
 * of the list (the cell's count, which the start offsets reset), written in the list at the run's start.
 */
export const MESH_GRID_COMPACT_WGSL = wgslProgram(
  `@group(0) @binding(${B.scatterCount}) var<storage,read> scatterCount:array<u32>;
@group(0) @binding(${B.scatterEntries}) var<storage,read> scatterEntries:array<u32>;
@group(0) @binding(${B.cells}) var<storage,read_write> cells:array<atomic<u32>>;
@group(0) @binding(${B.indices}) var<storage,read_write> indices:array<u32>;
@compute @workgroup_size(${MESH_GRID_GROUP})
fn msdfCompact(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=min(msdf.limits.x,scatterCount[0])){return;}
 let object=scatterEntries[id.x*${SCATTER_ENTRY_WORDS}u];
 let cell=scatterEntries[id.x*${SCATTER_ENTRY_WORDS}u+1u];
 let place=atomicAdd(&cells[cell*${CELL_WORDS}u],1u);
 indices[atomicLoad(&cells[cell*${CELL_WORDS}u+1u])+place]=object;
}`,
  [COMMON],
)
