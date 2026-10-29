import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { segmentBoxSpan } from '../../../../../math/src/wgsl/geometry.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { UNIQUE_BRICK } from '../../distanceField/layout.ts'
import { meshFieldWgsl } from '../../distanceField/meshFieldWgsl.ts'
import { meshGridCommonWgsl } from './commonWgsl.ts'

/** The steps a ray takes in one mesh's field at most, and the least step in a share of the volume (1 over 16 a step). */
const MESH_TRACE_STEPS = 64
const MIN_STEP = 1 / (16 * MESH_TRACE_STEPS)

/** The bindings a ray that traces the meshes takes from `first`: the meshes' fields (seven, `meshFieldWgsl`), the
 *  uniform (`MESH_GRID_PARAMS`), the grid's cells and the compacted lists. */
export const MESH_TRACE_BINDING = { params: 7, cells: 8, indices: 9 } as const

/** The declarations of the trace: the cells and the lists, the ray, the hit and the derived values. */
const meshTraceDeclarations = (
  group: number,
  first: number,
) => `@group(${group}) @binding(${first + MESH_TRACE_BINDING.cells}) var<storage,read> msdfCells:array<u32>;
@group(${group}) @binding(${first + MESH_TRACE_BINDING.indices}) var<storage,read> msdfIndices:array<u32>;
struct MsdfRay{start:vec3f,dir:vec3f,minTrace:f32,maxTrace:f32,expandByTime:bool,initialMax:f32,dithered:bool,ditherCoord:vec2f}
struct MsdfHit{distance:f32,object:u32}
struct MsdfDerived{normal:vec3f,instance:u32}`

/** The march of a ray through the field of one mesh. */
const MESH_TRACE_MARCH_WGSL = `fn msdfTraceMesh(ray:MsdfRay,object:u32,current:MsdfHit)->MsdfHit{
 var hit=current;
 let data=loadDfObjectData(object);
 var maxTrace=ray.maxTrace;
 if(!ray.dithered||!data.mostlyTwoSided){maxTrace=min(maxTrace,hit.distance+data.surfaceBias);}
 let volumeStart=dfWorldToVolume(data,DfVec3(ray.start,vec3f(0.0)));
 let volumeEnd=dfWorldToVolume(data,DfVec3(ray.start+ray.dir*maxTrace,vec3f(0.0)));
 var volumeDir=volumeEnd-volumeStart;
 let volumeMax=length(volumeDir);
 let volumeMin=volumeMax*(ray.minTrace/maxTrace);
 volumeDir=volumeDir/volumeMax;
 let span=segmentBoxSpan(volumeStart,volumeEnd,-data.extent,data.extent)*volumeMax;
 let first=max(span.x,volumeMin);
 if(!(first<span.y)){return hit;}
 let asset=dfAssetMip(data.asset,dfAssetMip(data.asset,0u).numMips-1u);
 let coverage=select(1.0,0.0,data.mostlyTwoSided&&ray.dithered);
 let expandScale=mix(msdf.trace.x,1.0,coverage);
 let minStep=${MIN_STEP}*mix(msdf.trace.y,1.0,coverage);
 var time=first;
 var maxDistance=ray.initialMax;
 var surface=false;
 var exhausted=true;
 for(var taken=0u;taken<${MESH_TRACE_STEPS}u;taken++){
  let field=sampleSparseMeshSdf(volumeStart+volumeDir*time,asset);
  maxDistance=max(field,maxDistance);
  let expandTime=select(maxDistance,time,ray.expandByTime);
  let expand=data.surfaceBias*saturate(expandTime/(2.0*data.surfaceBias))*expandScale;
  let noise=interleavedGradientNoise(ray.ditherCoord,f32(msdf.limits.w*${MESH_TRACE_STEPS}u+taken));
  if(field<expand&&(!ray.dithered||noise*(1.0-coverage)<=msdf.trace.z)){
   time=clamp(time+field-expand,first,span.y);
   surface=true;
   exhausted=false;
   break;
  }
  time+=max(field,minStep);
  if(time>span.y+expand){
   exhausted=false;
   break;
  }
 }
 if(exhausted){surface=true;}
 if(surface){
  let distance=length(volumeDir*time*data.volumeScale);
  if(distance<hit.distance){hit=MsdfHit(distance,object);}
 }
 return hit;
}`

/** The march through the meshes of a cell, and the normal and instance of the mesh a ray hit. */
const MESH_TRACE_CELL_WGSL = `fn msdfTraceCell(ray:MsdfRay,cell:u32)->MsdfHit{
 var hit=MsdfHit(ray.maxTrace,0u);
 let count=msdfCells[cell*2u];
 let start=msdfCells[cell*2u+1u];
 for(var k=0u;k<count&&start+k<msdf.limits.x;k++){
  hit=msdfTraceMesh(ray,msdfIndices[start+k],hit);
 }
 return hit;
}
fn msdfTraceDerived(ray:MsdfRay,hit:MsdfHit)->MsdfDerived{
 let data=loadDfObjectData(hit.object);
 let volume=clamp(dfWorldToVolume(data,DfVec3(ray.start+ray.dir*hit.distance,vec3f(0.0))),-data.extent,data.extent);
 let asset=dfAssetMip(data.asset,dfAssetMip(data.asset,0u).numMips-1u);
 let voxel=0.5/(${UNIQUE_BRICK}.0*asset.toIndirectionScale);
 let gradient=vec3f(
  sampleSparseMeshSdf(volume+vec3f(voxel.x,0.0,0.0),asset)-sampleSparseMeshSdf(volume-vec3f(voxel.x,0.0,0.0),asset),
  sampleSparseMeshSdf(volume+vec3f(0.0,voxel.y,0.0),asset)-sampleSparseMeshSdf(volume-vec3f(0.0,voxel.y,0.0),asset),
  sampleSparseMeshSdf(volume+vec3f(0.0,0.0,voxel.z),asset)-sampleSparseMeshSdf(volume-vec3f(0.0,0.0,voxel.z),asset));
 let size=length(gradient);
 let inVolume=select(vec3f(0.0),gradient/size,size>0.0);
 let inWorld=inVolume.x*data.rows[0].xyz+inVolume.y*data.rows[1].xyz+inVolume.z*data.rows[2].xyz;
 let worldSize=length(inWorld);
 return MsdfDerived(select(vec3f(0.0),inWorld/worldSize,worldSize>0.0),data.instance);
}`

/**
 * A RAY TRACED THROUGH THE MESHES OF A CELL (`msdfTraceCell`): the nearest of the meshes the cell lists that the ray
 * meets, within its range. Each mesh (`msdfTraceMesh`) takes the ray into its volume, clipped to the box of the volume
 * from the least distance on and, once a mesh has been hit, to that hit plus the mesh's surface bias (but not so for a mesh
 * that is mostly two-sided traced by a dithered ray, whose surface is a chance). Along it, at most
 * `MESH_TRACE_STEPS` steps, the finest mip is read; the surface is expanded by the bias times the share of the time
 * (or of the largest distance read, `expandByTime` false) over twice the bias, times the expansion scale of a mesh not
 * covered (a mostly two-sided mesh traced dithered), and the ray is on it where the field is under that: the ray goes
 * on to the surface, less the expansion, within the box, and (dithered) is stopped by the noise of the step only where
 * the mesh is not covered, under the step threshold. The step is the field, at least a sixteenth of a step's share of the
 * volume times the scale of the least step of a mesh not covered. A ray that goes through all its steps is a hit at the
 * place it reached. The hit's distance is the world's, through the mesh's scale.
 *
 * `msdfTraceDerived`: from the hit, the normal of the mesh there (the gradient of the field at the finest mip, six reads half a
 * voxel either side, through the transpose of the world-to-volume rows, so that a non-uniform scale is handled) and the
 * mesh's instance, which the caller finds the surface cache's cards and the motion by.
 *
 * A cell's list holds the entries `limits.x` bounds (the lists' room), no more are read. The caller finds the cell (`msdfCellIndex`) of the pixel's position and depth, and the bindings of the fields, the
 * uniform and the lists are `MESH_TRACE_BINDING` from the offset `first` of the group.
 */
export const meshTraceWgsl = (group: number, first: number) =>
  wgslBlock(
    `MESH_TRACE_WGSL ${group} ${first}`,
    [
      meshFieldWgsl(group, first),
      meshGridCommonWgsl(group, first + MESH_TRACE_BINDING.params),
      interleavedGradientNoise,
      segmentBoxSpan,
    ],
    ['\n' + meshTraceDeclarations(group, first), MESH_TRACE_MARCH_WGSL, MESH_TRACE_CELL_WGSL].join(
      '\n',
    ),
  )
