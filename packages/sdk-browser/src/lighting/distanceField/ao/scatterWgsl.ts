import { sinFromCosUnclamped } from '../../../../../math/src/wgsl/geometry.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { DFAO_BINDING as B } from './layout.ts'
import { meshFieldWgsl } from '../meshFieldWgsl.ts'

/**
 * THE MESHES SCATTERED TO THE SCREEN TILES (`dfaoObjectCullVs`, `dfaoObjectCullCount`, `dfaoObjectCullWrite`): the
 * bounding sphere of every culled mesh is drawn — its back faces, for the eye may be inside —, enlarged by the
 * occlusion distance and by the factor that puts the edges of the coarse sphere on the true one
 * (`dfao.jitter.z`), into a target with a pixel a tile; each pixel is a tile the sphere covers, and decides
 * whether the mesh reaches that tile's rays.
 *
 * The decision (`dfaoTileHit`): the sphere, in the eye's frame and grown by half the occlusion distance, must meet the
 * tile's cone (`dfaoSphereMeetsCone`); then the range of distance it covers along the cone's axis must
 * lie within one of the tile's two ranges, and the mesh's field must come, at the centre of the sphere that bounds the
 * tile's slice of that range, within the radius of that sphere plus the occlusion distance
 * (`dfaoReachesRange`: the box's distance is checked first). The count pass adds one to the mesh's tiles; the
 * write pass takes the next place in the mesh's run of the list and writes the tile and the mesh in it. The
 * target is a stand-in: the passes write no colour.
 */
export const DFAO_OBJECT_CULL_WGSL = wgslProgram(
  `@group(0) @binding(${B.culledObjects}) var<storage,read> culledObjects:array<u32>;
@group(0) @binding(${B.tileAxis}) var<storage,read> tileAxis:array<vec4f>;
@group(0) @binding(${B.tileRanges}) var<storage,read> tileRanges:array<vec4f>;
@group(0) @binding(${B.tileCounts}) var<storage,read_write> tileCounts:array<atomic<u32>>;
@group(0) @binding(${B.tileOffsets}) var<storage,read> tileOffsets:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read_write> tileData:array<u32>;
struct CullVertex{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) center:vec4f,
 @location(1) @interpolate(flat) ids:vec2u,
}
@vertex
fn dfaoObjectCullVs(@location(0) corner:vec4f,@builtin(instance_index) instance:u32)->CullVertex{
 let object=culledObjects[instance];
 let bounds=loadDfObjectBounds(object);
 let center=bounds.center.hi+bounds.center.lo;
 let radius=(bounds.sphereRadius+dfao.distances.x)*dfao.jitter.z;
 return CullVertex(dfao.viewProjection*vec4f(corner.xyz*radius+center,1.0),vec4f(center,bounds.sphereRadius),vec2u(object,instance));
}
fn dfaoSphereMeetsCone(sphere:vec4f,axis:vec3f,cosine:f32,sine:f32)->bool{
 let u=-(sphere.w/sine)*axis;
 var d=sphere.xyz-u;
 var distanceSquared=dot(d,d);
 var e=dot(axis,d);
 if(e>0.0&&e*e>=distanceSquared*cosine*cosine){
  d=sphere.xyz;
  distanceSquared=dot(d,d);
  e=-dot(axis,d);
  if(e>0.0&&e*e>=distanceSquared*sine*sine){return distanceSquared<=sphere.w*sphere.w;}
  return true;
 }
 return false;
}
fn dfaoReachesRange(axis:vec3f,cosine:f32,sine:f32,range:vec2f,reach:vec2f,object:u32)->bool{
 if(!(reach.x>range.x&&reach.y<range.y)){return false;}
 let data=loadDfObjectData(object);
 let middle=axis*(0.5*(range.x+range.y));
 let centre=(dfao.viewToWorld*vec4f(middle,1.0)).xyz;
 let along=0.5*(range.y-range.x);
 let toEdge=range.y*sine/cosine;
 let radius=sqrt(along*along+toEdge*toEdge);
 let volumeCentre=dfWorldToVolume(data,DfVec3(centre,vec3f(0.0)));
 if(dfaoBoxDistance(-data.extent,data.extent,volumeCentre)*data.volumeScale>=radius+dfao.distances.x){return false;}
 let clamped=clamp(volumeCentre,-data.extent,data.extent);
 let toOccluder=(distanceToMeshSurfaceStandalone(clamped,data)+length(volumeCentre-clamped))*data.volumeScale;
 return toOccluder<radius+dfao.distances.x;
}
fn dfaoTileHit(v:CullVertex)->bool{
 let tile=vec2u(v.position.xy);
 let at=tile.y*dfao.cones.z+tile.x;
 let axisCosine=tileAxis[at];
 let ranges=tileRanges[at];
 let sine=sinFromCosUnclamped(axisCosine.w);
 let centre=(dfao.worldToView*vec4f(v.center.xyz,1.0)).xyz;
 let sphere=vec4f(centre,v.center.w+0.5*dfao.distances.x);
 if(!dfaoSphereMeetsCone(sphere,axisCosine.xyz,axisCosine.w,sine)){return false;}
 let reach=dot(sphere.xyz,axisCosine.xyz);
 let minMax=vec2f(reach+sphere.w,reach-sphere.w);
 return dfaoReachesRange(axisCosine.xyz,axisCosine.w,sine,ranges.xy,minMax,v.ids.x)
  ||dfaoReachesRange(axisCosine.xyz,axisCosine.w,sine,ranges.zw,minMax,v.ids.x);
}
@fragment
fn dfaoObjectCullCount(v:CullVertex)->@location(0) vec4f{
 if(dfaoTileHit(v)){atomicAdd(&tileCounts[v.ids.y],1u);}
 return vec4f(0.0);
}
@fragment
fn dfaoObjectCullWrite(v:CullVertex)->@location(0) vec4f{
 if(dfaoTileHit(v)){
  let slot=tileOffsets[v.ids.y]+atomicAdd(&tileCounts[v.ids.y],1u);
  let tile=vec2u(v.position.xy);
  tileData[slot*2u]=tile.y*dfao.cones.z+tile.x;
  tileData[slot*2u+1u]=v.ids.x;
 }
 return vec4f(0.0);
}`,
  [DFAO_COMMON_WGSL, meshFieldWgsl(0, B.objects), sinFromCosUnclamped],
)
